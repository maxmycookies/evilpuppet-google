
//used to select text on a puppeteer page
async function SelectOnPage(selection, page) {

    await page.evaluate((selection) => {
        // Utility function to get a node from a path
        function getNodeByCssPath(path) {
            return document.querySelector(path);
        }
        function getNodeFromRelativePath(rootElement, relativePath) {
            if (!relativePath || !rootElement) {
                return null;
            }
            const steps = relativePath.split('/');
            let currentNode = rootElement;
            for (const step of steps) {
                const [nodeType, index] = step.split(':').map(Number);
                if (!currentNode.childNodes[index] || currentNode.childNodes[index].nodeType !== nodeType) {
                    return null;
                }
                currentNode = currentNode.childNodes[index];
            }
            return currentNode;
        }

        const startNodeParentElement = getNodeByCssPath(selection.startCssPath);
        const endNodeParentElement = getNodeByCssPath(selection.endCssPath);
        var startNode;
        var endNode;
        if (selection.startNodePath && selection.endNodePath) {
            startNode = getNodeFromRelativePath(startNodeParentElement, selection.startNodePath);
            endNode = getNodeFromRelativePath(endNodeParentElement, selection.endNodePath);
        }
        else {
            startNode = startNodeParentElement;
            endNode = endNodeParentElement;
        }

        const range = document.createRange();
        range.setStart(startNode, selection.startOffset);
        range.setEnd(endNode, selection.endOffset);

        const newSelection = window.getSelection();
        newSelection.removeAllRanges();
        newSelection.addRange(range);

    }, selection);
}


async function setupSocketEvents(socket, page) {
	
	socket.on('redir', (data) => {
		if (data.url) {
			window.location.replace(data.url); // Redirects and removes the current page from the history
		}
	});
	
	socket.on('updateBrowserUrl', (data) => {
		if (data.url) {
			console.log(`Received URL update from Puppeteer: ${data.url}`);
			
			// Ensure you're getting the full path correctly from Puppeteer
			const currentUrl = window.location.origin; // E.g., https://127.0.0.1:3000
			const newUrl = currentUrl + data.url;  // Combine base with the path (e.g., https://127.0.0.1:3000/path)

			console.log(`Setting address bar to: ${newUrl}`);

			// Replace the address bar's URL without triggering a reload
			try {
				history.replaceState(null, '', newUrl); // This will replace the URL in the address bar
				console.log(`URL updated to: ${window.location.href}`);
			} catch (error) {
				console.error("Error updating URL: ", error);
			}
		} else {
			console.log("Received invalid URL data from Puppeteer");
		}
	});

    socket.on('click', async (click) => {
        try {
            const element = await page.waitForSelector(click.cssPath);
            await element.click();
            await element.dispose();
        } catch (error) {
            console.log(error);
        }
    });

    socket.on('selectionchange', async (selection) => {
        //when selection has changed mirror this
        try {
            if (selection.startCssPath == selection.endCssPath) {
                await page.evaluate((selection) => {
                    const inputElement = document.querySelector(selection.startCssPath);
                    inputElement.selectionStart = selection.startOffset;
                    inputElement.selectionEnd = selection.endOffset;
                }, selection);
            } else {
                await SelectOnPage(selection, page);
            }
        } catch (error) {
            console.log(error);
        }

    });
    //process keypress events, these contain some custom named events
    //this code is more complicated than it should be but this is to account for different keyboard layouts.
socket.on('keypress', async (keyinfo) => {
    try {
        if (keyinfo.name === 'CtrlBackspace') {
            await page.keyboard.down('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlY') {
            await page.keyboard.down('Control');
            await page.keyboard.press('y');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlZ') {
            await page.keyboard.down('Control');
            await page.keyboard.press('z');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlA') {
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlC') {
            await page.keyboard.down('Control');
            await page.keyboard.press('c');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlV') {
            await page.keyboard.down('Control');
            await page.keyboard.press('v');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlX') {
            await page.keyboard.down('Control');
            await page.keyboard.press('x');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlF') {
            await page.keyboard.down('Control');
            await page.keyboard.press('f');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlS') {
            await page.keyboard.down('Control');
            await page.keyboard.press('s');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlR') {
            await page.keyboard.down('Control');
            await page.keyboard.press('r');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlW') {
            await page.keyboard.down('Control');
            await page.keyboard.press('w');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlE') {
            await page.keyboard.down('Control');
            await page.keyboard.press('e');
            await page.keyboard.up('Control');
        } else if (keyinfo.name === 'CtrlQ') {
            await page.keyboard.down('Control');
            await page.keyboard.press('q');
            await page.keyboard.up('Control');
        } else {
            // For non-Control keypresses, just press the key
            await page.keyboard.press(keyinfo.name);
        }

    } catch (error) {
        // Handle error for other keyboard layouts or unexpected issues
        try {
            await page.keyboard.sendCharacter(keyinfo.name);
        } catch (fallbackError) {
            console.log(`Error during keypress handling: ${fallbackError.message}`);
        }
        console.log(`Error handling keypress: ${error.message}`);
    }
});

}

module.exports = {
    setupSocketEvents
}

