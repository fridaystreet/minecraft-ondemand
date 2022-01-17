var AWS = require('aws-sdk')

const getEniPublicIP = (eni) => {
  var ec2 = new AWS.EC2({
    region: 'ap-southeast-2'
  });

  ec2.describeNetworkInterfaces({
    NetworkInterfaceIds: [
      eni
   ]    
  }, (err, result) => {
    if (err) throw new Error(err);
    console.log(result.NetworkInterfaces[0].Association.PublicIp)
  });
}

getEniPublicIP(process.argv[2]);