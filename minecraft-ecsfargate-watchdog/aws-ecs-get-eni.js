var AWS = require('aws-sdk')

var ecs = new AWS.ECS({
  region: 'ap-southeast-2'
});

const getEni = (cluster, task) => {
  ecs.describeTasks({
    tasks: [task],
    cluster: cluster
  }, (err, result) => {
    if (err) throw new Error(err);
    const details = result.tasks[0].attachments[0].details;
    const eni = details.filter(d => d.name === 'networkInterfaceId')[0].value
    console.log(eni);
  });
}

getEni(process.argv[2], process.argv[3]);