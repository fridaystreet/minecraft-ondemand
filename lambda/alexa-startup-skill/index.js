/* *
 * This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
 * Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
 * session persistence, api calls, and more.
 * */
const Alexa = require('ask-sdk-core');
const AWS = require('aws-sdk');
const mc = require('minecraft-protocol');

const ecs = new AWS.ECS({
    region: process.env.REGION
});

const getEcsStatus = async () => {

    try {
        const status = await ecs.describeServices({
          cluster: process.env.CLUSTER,
          services: [process.env.SERVICE]
        }).promise();
        
        console.log('describe ecs', status);
        return {
          desired: status["services"][0]["desiredCount"],
          pending: status["services"][0]["pendingCount"],
          active: status["services"][0]["runningCount"]  
        }        
    } catch(e) {
        console.log('describe ecs error', e);
        throw e;
    }
}

const updateDesiredCount = async (desiredCount) => {
  
  try {   
      return await ecs.updateService({
        desiredCount, 
        cluster: process.env.CLUSTER,
        service: process.env.SERVICE
      }).promise();
    } catch(e) {
        console.log('updateService error', e);
        throw e;
    }
} 
 
const getMinecraftStatus = async (host) => {
    //returns {"description":{"text":"Welcome to The Creepers Server"},"players":{"max":20,"online":0},"version":{"name":"Paper 1.18.1","protocol":757},"latency":0}
    try {
        const { players } = await mc.ping({
          host
        });

        return {
            players
        }
    } catch(e) {
        console.log('minecraft error: ', e)
        throw e
    }
}
const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        const speakOutput = 'Welcome to Jensenstyle minecraft, now the skill is installed, you can just say start jensenstyle minecraft to start the server. The server will automatically shut off 20 minutes after there are no more users logged in';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const StartIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'start';
    },
    async handle(handlerInput) {
        
        console.log('handlerInput', handlerInput);
        let speakOutput;
    
        try {
            const status = await getEcsStatus();
            console.log('status', status);
            if (status.desired === 1) {
                speakOutput = `The server is currently starting up. please wait`;
                if (status.active === 1) {
                    try {
                        console.log('check minecraft status', process.env.SERVERNAME);
                        const { players } = await getMinecraftStatus(process.env.SERVERNAME);
                        speakOutput = `The server is running. There are ${players.online} out of ${players.max} max players online.`
                    } catch(e) {
                        speakOutput = `The server is already running, but I couldn't get the game status`;                    
                    }
                }
                return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt(speakOutput)
                .getResponse();
            }
        } catch(e) {
            speakOutput = `Unable to check the service status. The error returned was ${e.message}`
            return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
        }
        

       speakOutput = 'The server is starting, this will take approximately 5 minutes. I will send you an sms when it\'s ready';

        try {
          const result = await updateDesiredCount(1);
          console.log('updateEcs 1', result)
        } catch(e) {   
          speakOutput = `Failed to initialise startup. The error returned was ${e.message}`    
        }
        console.log('success');
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'You can just say start jensenstyle minecraft to start, or stop minecraft to stop';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    async handle(handlerInput) {

        let speakOutput;
        try {
            const status = await getEcsStatus();
            console.log('stop status', status);

            speakOutput = 'The server is currently starting up';
            if (status.desired === 0) {
                speakOutput = `The server is not running`;
                return handlerInput.responseBuilder
                .speak(speakOutput)
                .getResponse();
            }
            if (status.active === 1) {
                try {
                    console.log('check minecraft status', process.env.SERVERNAME);
                    const { players } = await getMinecraftStatus(process.env.SERVERNAME);

                    speakOutput = `There are still ${players.online} players online. The server will stop 20 minutes after they have disconnected`;
                    
                    if (players.online === 0) {
                        speakOutput = `There are no players online, stopping the server now`;
                        try {
                           const result = await updateDesiredCount(0);
                            console.log('updateEcs 0', result)
                        } catch(e) {   
                            speakOutput = `Failed to stop server. The error returned was ${e.message}`    
                        }                        
                    }
                } catch(e) {
                    speakOutput = `I couldn't get the game status, the server will stop 20 minutes after the last player disconnects`;                    
                }
            } else {
                try {
                    speakOutput = `The server is currently starting up, stopping the server now`;
                    const result = await updateDesiredCount(0);
                    console.log('updateEcs 0', result)
                } catch(e) {   
                    speakOutput = `Failed to stop server. The error returned was ${e.message}`    
                }                         
            }
            return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
        } catch(e) {
            console.log(e);
            speakOutput = `Unable to check the service status. The error returned was ${e.message}`
            return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
        }
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Sorry, I don\'t know about that. Please try again.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};
/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        StartIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .withCustomUserAgent('minecraft/alexa/v1.0')
    .lambda();