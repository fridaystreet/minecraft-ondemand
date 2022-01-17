#!/bin/bash

## Required Environment Variables
[ -n "$CLUSTER" ] || { echo "CLUSTER env variable must be set to the name of the ECS cluster" ; exit 1; }
[ -n "$SERVICE" ] || { echo "SERVICE env variable must be set to the name of the service in the $CLUSTER cluster" ; exit 1; }
[ -n "$SERVERNAME" ] || { echo "SERVERNAME env variable must be set to the full A record in Route53 we are updating" ; exit 1; }
[ -n "$DNSZONE" ] || { echo "DNSZONE env variable must be set to the Route53 Hosted Zone ID" ; exit 1; }
[ -n "$STARTUPMIN" ] || { echo "STARTUPMIN env variable not set, defaulting to a 10 minute startup wait" ; STARTUPMIN=10; }
[ -n "$SHUTDOWNMIN" ] || { echo "SHUTDOWNMIN env variable not set, defaulting to a 20 minute shutdown wait" ; SHUTDOWNMIN=20; }

function send_notification ()
{
  [ "$1" = "startup" ] && MESSAGETEXT="Minecraft container online"
  [ "$1" = "shutdown" ] && MESSAGETEXT="Shutting down Minecraft Server"

  ## Twilio Option
  [ -n "$TWILIOFROM" ] && [ -n "$TWILIOTO" ] && [ -n "$TWILIOAID" ] && [ -n "$TWILIOAUTH" ] && \
  echo "Twilio information set, sending $1 message" && \
  curl --silent -XPOST -d "Body=$MESSAGETEXT" -d "From=$TWILIOFROM" -d "To=$TWILIOTO" "https://api.twilio.com/2010-04-01/Accounts/$TWILIOAID/Messages" -u "$TWILIOAID:$TWILIOAUTH"

  ## SNS Option
  [ -n "$SNSTOPIC" ] && \
  echo "SNS topic set, sending $1 message" && \
  aws sns publish --topic-arn "$SNSTOPIC" --message "$MESSAGETEXT"
}

function zero_service ()
{
  send_notification shutdown
  echo Setting desired task count to zero.
  aws ecs update-service --cluster $CLUSTER --service $SERVICE --desired-count 0
  exit 0
}

function sigterm ()
{
  ## upon SIGTERM set the service desired count to zero
  echo "Received SIGTERM, terminating task..."
  zero_service
}
trap sigterm SIGTERM

## get task id from the Fargate metadata
TASK=$(curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq -r '.TaskARN' | awk -F/ '{ print $NF }')
echo I believe our task id is $TASK

## get eni from from ECS
ENI=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASK --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" --output text)
echo I believe our eni is $ENI

## get public ip address from EC2
PUBLICIP=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].Association.PublicIp' --output text)
echo "I believe our public IP address is $PUBLICIP"

[ -n "$PUBLICIP" ] || { echo "PUBLICIP could not be determined" ; exit 1; }

## update public dns record
echo "Updating DNS record for $SERVERNAME to $PUBLICIP"
## prepare json file
cat << EOF >> minecraft-dns.json
{
  "Comment": "Fargate Public IP change for Minecraft Server",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$SERVERNAME",
        "Type": "A",
        "TTL": 30,
        "ResourceRecords": [
          {
            "Value": "$PUBLICIP"
          }
        ]
      }
    }
  ]
}
EOF
aws route53 change-resource-record-sets --hosted-zone-id $DNSZONE --change-batch file://minecraft-dns.json


echo "Checking every 30 seconds for service to become available and a player to connect, up to $STARTUPMIN minutes..."

COUNTER=0
PLAYERS=0
MAXPLAYERS=0
ONLINE=false
TOTALCOUNT=$(( $STARTUPMIN*2 ))
while [ $PLAYERS -lt 1 ]
do
  COUNTER=$(($COUNTER + 1))
  if [ $ONLINE = false ]
  then
    echo "Waiting for connection, attempt $COUNTER/$TOTALCOUNT over $STARTUPMIN mins..."
  else
    echo "Waiting for a player to connect, attempt $COUNTER/$TOTALCOUNT over $STARTUPMIN mins..."
  fi
  json=$(source ~/.bashrc && node minecraft-ping.js $PUBLICIP)
  echo "server check"
  echo "result: $json"
  error=`echo $json | jq '.error' | grep ECONNREFUSED` 
  if [ ! -z "$error" ]
  then
    echo "error: $error"
    for i in $(seq 1 30) ; do sleep 1; done
    continue
  fi
  PLAYERS=`echo $json | jq '.players.online'`
  MAXPLAYERS=`echo $json | jq '.players.max'`
  echo "Players online: $PLAYERS"

  if [ $ONLINE = false ]
  then
    if [ $MAXPLAYERS -gt 0 ]
    then
      echo "minecraft service has started, max allowed players $MAXPLAYERS" 
      ONLINE=true
      ## Send startup notification message
      send_notification startup
    fi
  fi

  if [ $PLAYERS -gt 0 ] ## at least one active connection detected, break out of loop
  then
    break
  fi
  if [ $COUNTER -gt $STARTUPMIN ] ## no one has connected in at least these many minutes
  then
    echo $STARTUPMIN minutes exceeded without a connection, terminating.
    zero_service
  fi
  ## only doing short sleeps so that we can catch a SIGTERM if needed
  for i in $(seq 1 30) ; do sleep 1; done
done

echo "We believe a connection has been made, switching to shutdown watcher."
COUNTER=0
while [ $COUNTER -le $SHUTDOWNMIN ]
do
  COUNTER=$(($COUNTER + 1))      
  json=$(source ~/.bashrc && node minecraft-ping.js $PUBLICIP)
  echo "server check"
  echo "result: $json"
  error=`echo $json | jq '.error' | grep ECONNREFUSED` 
  if [ ! -z "$error" ]
  then
    echo "error: $error"
    for i in $(seq 1 30) ; do sleep 1; done
    continue
  fi
  PLAYERS=`echo $json | jq '.players.online'`
  echo "Players online: $PLAYERS"

  if [ $PLAYERS -lt 1 ]
  then
      echo "No active connections detected, attempt $COUNTER/$TOTALCOUNT over $SHUTDOWNMIN minutes..."
  else
    [ $COUNTER -gt 0 ] && echo "New connections active, zeroing counter."
    COUNTER=0
  fi
  for i in $(seq 1 30) ; do sleep 1; done
done

echo "$SHUTDOWNMIN minutes elapsed without a connection, terminating."
zero_service
