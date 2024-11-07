import 'dotenv/config';
import { AirtopClient, AirtopError } from '@airtop/sdk';
import chalk from 'chalk';

const AIRTOP_API_KEY = process.env.AIRTOP_API_KEY;
const LOGIN_URL = 'https://www.glassdoor.com/member/profile';
const IS_LOGGED_IN_PROMPT = `This browser is open to a page that either display's a user's Glassdoor profile or prompts the user to login.  Please give me a JSON response matching the schema below.`;
const IS_LOGGED_IN_OUTPUT_SCHEMA = {
	$schema: "http://json-schema.org/draft-07/schema#",
	type: "object",
	properties: {
		isLoggedIn: {
			type: "boolean",
			description: "Use this field to indicate whether the user is logged in.",
		},
		error: {
			type: "string",
			description:
				"If you cannot fulfill the request, use this field to report the problem.",
		},
	},
};
const TARGET_URL = 'https://www.glassdoor.com/Job/san-francisco-ca-software-engineer-jobs-SRCH_IL.0,16_IC1147401_KO17,34.htm'; // A search for software engineer jobs on Glassdoor
const EXTRACT_DATA_PROMPT = `This browser is open to a page that lists available job roles for software engineers in San Francisco. Please provide 10 job roles that appear to be posted by the AI-related companies.`;

const EXTRACT_DATA_OUTPUT_SCHEMA = {
	$schema: "http://json-schema.org/draft-07/schema#",
	type: "object",
	properties: {
		companies: {
			type: "array",
			items: {
				type: "object",
				properties: {
					companyName: {
						type: "string",
					},
					jobTitle: {
						type: "string",
					},
					location: {
						type: "string",
					},
					salary: {
						type: "object",
						properties: {
							min: {
								type: "number",
								minimum: 0,
							},
							max: {
								type: "number",
								minimum: 0,
							},
						},
						required: ["min", "max"],
					},
				},
				required: ["companyName", "jobTitle", "location", "salary"],
			},
		},
		error: {
			type: "string",
			description:
				"If you cannot fulfill the request, use this field to report the problem.",
		},
	},
};

async function run() {
  try {
    if (!AIRTOP_API_KEY) {
      throw new Error('AIRTOP_API_KEY is not set');
    }
    const client = new AirtopClient({
      apiKey: AIRTOP_API_KEY,
    });
    const profileId: string | undefined = await new Promise<string | undefined>((resolve) => {
      process.stdout.write('Enter a profileId (or press Enter to skip): ');
      process.stdin.once('data', (input) => {
        const trimmedInput = input.toString().trim();
        resolve(trimmedInput || undefined);
        console.log(trimmedInput ? `Using profileId: ${trimmedInput}` : 'No profileId provided');
      });
    });
    const createSessionResponse = await client.sessions.create({
      configuration: {
        timeoutMinutes: 10,
        persistProfile: !profileId, // Only persist a new profile if we do not have an existing profileId
        baseProfileId: profileId,
      },
    });

    const session = createSessionResponse.data;
    console.log('Created airtop session', session.id);

    if (!createSessionResponse.data.cdpWsUrl) {
      throw new Error('Unable to get cdp url');
    }

    // Create a new window and navigate to the URL
    const windowResponse = await client.windows.create(
      session.id,
      { url: LOGIN_URL }
    );
    
    const windowInfo = await client.windows.getWindowInfo(session.id, windowResponse.data.windowId);

    // Check whether the user is logged in
    console.log('Determining whether the user is logged in...');
    const isLoggedInPromptResponse = await client.windows.pageQuery(session.id, windowInfo.data.windowId, {
      prompt: IS_LOGGED_IN_PROMPT,
      configuration: {
        outputSchema: IS_LOGGED_IN_OUTPUT_SCHEMA,
      },
    });
    const parsedResponse = JSON.parse(isLoggedInPromptResponse.data.modelResponse);
    if (parsedResponse.error) {
      throw new Error(parsedResponse.error);
    }
    const isUserLoggedIn = parsedResponse.isLoggedIn;

    // Prompt the user to log in if they are not logged in already
    if (!isUserLoggedIn) {
      console.log('Log into your Glassdoor account on the live view of your browser window.  Press `Enter` once you have logged in.', chalk.blueBright(windowInfo.data.liveViewUrl));
      await new Promise<void>(resolve => process.stdin.once('data', () => resolve()));
      console.log('To avoid logging in again, use the following profileId the next time you run this script: ', chalk.green(session.profileId));
    } else {
      console.log('User is already logged in. View progress at the following live view URL:', chalk.blueBright(windowInfo.data.liveViewUrl));
    }

    // Navigate to the target URL
    console.log('Navigating to target url');
    await client.windows.loadUrl(session.id, windowInfo.data.windowId, { url: TARGET_URL });
    console.log('Prompting the AI agent, waiting for a response (this may take a few minutes)...');
    const promptContentResponse = await client.windows.pageQuery(session.id, windowInfo.data.windowId, {
      prompt: EXTRACT_DATA_PROMPT,
      followPaginationLinks: true, // This will tell the agent to load additional results via pagination links or scrolling
      configuration: {
        outputSchema: EXTRACT_DATA_OUTPUT_SCHEMA,
      },
    });
    const formattedJson = JSON.stringify(JSON.parse(promptContentResponse.data.modelResponse), null, 2);
    console.log('Response:\n\n', chalk.green(formattedJson));

    // Clean up. Comment out the next two lines if you want to access the live view after the script completes.
    await client.windows.close(session.id, windowInfo.data.windowId);
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