import { Amplify } from 'aws-amplify';

// AWS Cognito configuration
const awsConfig = {
  Auth: {
    Cognito: {
      // Amazon Cognito Region
      region: 'us-east-1',
      
      // Amazon Cognito User Pool ID
      userPoolId: 'us-east-1_EVBRTIOe9',
      
      // Amazon Cognito Web Client ID
      userPoolClientId: '2uk2kuqg3u8v2ie1cd4fh06hh9',
      
      // Set loginWith to username
      loginWith: {
        username: true
      }
    }
  }
};

// Configure Amplify globally
export const configureAmplify = () => {
  // @ts-ignore - Ignore TypeScript error since Amplify v6 has different typing
  Amplify.configure(awsConfig);
};

export default awsConfig; 