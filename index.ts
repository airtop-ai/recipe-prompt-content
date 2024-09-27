import 'dotenv/config';
import puppeteer, { Browser, Page } from 'puppeteer';
import { AirtopClient, AirtopError } from '@airtop/sdk';
import chalk from 'chalk';

const AIRTOP_API_KEY = process.env.AIRTOP_API_KEY;
const LOGIN_URL = 'https://www.glassdoor.com/profile/login_input.htm';
const TARGET_URL = 'https://www.glassdoor.com/Job/san-francisco-ca-software-engineer-jobs-SRCH_IL.0,16_IC1147401_KO17,34.htm'; // A search for software engineer jobs on Glassdoor
const PROMPT = `This browser is open to a page that lists available job roles for software engineers in San Francisco. Please list 10 job roles that appear to be posted by the AI-related companies.

Return your response in the following format:

1. Company Name: Company A, Location: San Francisco, Salary: $100,000 - $120,000
2. Company Name: Company B, Location: San Francisco, Salary: $110,000 - $130,000
3. Company Name: Company C, Location: San Francisco, Salary: $95,000 - $115,000`;

async function run() {
  try {
    const client = new AirtopClient({
      apiKey: AIRTOP_API_KEY,
    });
    const createSessionResponse = await client.sessions.create({
      configuration: {
        timeoutMinutes: 10,
      },
    });

    const session = createSessionResponse.data;
    console.log('Created airtop session', session.id);

    if (!createSessionResponse.data.cdpWsUrl) {
      throw new Error('Unable to get cdp url');
    }

    // Connect to the browser
    const cdpUrl = createSessionResponse.data.cdpWsUrl;
    const browser: Browser = await puppeteer.connect({
      browserWSEndpoint: cdpUrl,
      headers: {
        Authorization: `Bearer ${AIRTOP_API_KEY}` || '',
      },
    });
    console.log('Connected to browser');

    // Open a new page
    const page: Page = await browser.newPage();

    // Allow user to login so that they can access communities that might require authentication
    console.log('Navigating to login page');
    await page.goto(LOGIN_URL);
    const windowInfo = await client.windows.getWindowInfoForPuppeteerPage(session, page, {
      disableResize: true, // Prevents the browser window from resizing when a live view is loaded, in case scraping is dependent on what is inside the the visible window
    }); 
    console.log('Log into your Glassdoor account on the live view of your browser window.  Press `Enter` once you have logged in.', chalk.blueBright(windowInfo.data.liveViewUrl));
    await new Promise<void>(resolve => process.stdin.once('data', () => resolve()));

    // Navigate to the target URL
    console.log('Navigating to target URL');
    await page.goto(TARGET_URL);
    console.log('Prompting the AI agent, waiting for a response (this may take a few minutes)...');
    const promptContentResponse = await client.windows.promptContent(session.id, windowInfo.data.windowId, {
      prompt: PROMPT,
      followPaginationLinks: true, // This will tell the agent to load additional results via pagination links or scrolling
    });
    console.log('Response:\n\n', chalk.green(promptContentResponse.data.modelResponse));

    // Clean up
    await browser.close();
    await client.sessions.terminate(session.id);
    console.log(chalk.red('\nSession terminated'));
    process.exit(0);
  } catch (err) {
    if (err instanceof AirtopError) {
      console.error(err.statusCode);
      console.error(err.message);
      console.error(err.body);
    } else {
      console.error(err);
    }
    throw err;
  }
}

run().catch((err) => {
  process.exit(1);
});