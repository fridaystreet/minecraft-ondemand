# version 1.2.0
# docker pull fridaystreet/minecraft-ecsfargate-watchdog

FROM amazon/aws-cli 

RUN yum install -y jq tar gzip


RUN touch ~/.bashrc && chmod +x ~/.bashrc
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
RUN . ~/.nvm/nvm.sh && source ~/.bashrc && nvm install 14

COPY './package.json' .
RUN source ~/.bashrc && npm install

COPY ./watchdog.sh .
COPY './minecraft-ping.js' .
# COPY './aws-ecs-get-eni.js' .
# COPY './aws-eni-get-public-ip.js' .

ENTRYPOINT ["./watchdog.sh"]
