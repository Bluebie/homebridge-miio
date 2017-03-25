// for discovering miio devices that advertise over MDNS
const mdns = require('mdns');
const miio = require('miio');
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  console.log("homebridge API version: " + homebridge.version);

  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;

  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  // register platform in to homebridge
  homebridge.registerPlatform("homebridge-miio", "XiaomiMiio", XiaomiMiio, true);
}

// Platform constructor
// config may be null
// api may be null if launched from old homebridge version
function XiaomiMiio(log, config, api) {
  log("Setting up Miio platform");
  var platform = this;
  this.log = log;
  this.config = config;
  this.accessories = {};

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object.
    this.api = api;

    // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories
    // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
    // Or start discover new accessories
    this.api.on('didFinishLaunching', ()=> {
      platform.log("DidFinishLaunching");

      // watch all miio devices announcing over mdns
      var browser = mdns.createBrowser(mdns.udp('miio'));
      browser.on('serviceUp', (service)=> {
        if (!this.accessories[service.host]) {
          this.addAccessory(service.host, service.port);
        } else {
          if (this.accessories[service.host].miioConfigured == false) this._setupDevice(service.host);
          this.accessories[service.host].updateReachability(true);
        }
      });
      browser.on('serviceDown', (service)=> {
        if (this.accessories[service.host]) this.accessories[service.host].updateReachability(false);
      });
      browser.start();

      // start polling the Xiaomi devices on network for current status in case other things change them
      if (this.config.pollChanges !== false)
        setInterval(()=> this.pollDevices(), (this.config.pollInterval || 15) * 1000);
      this.pollDevices();
    });
  }
}

XiaomiMiio.prototype._setupDevice = function(hostname, done) {
  // create device api
  var accessory = this.accessories[hostname];
  if (!accessory) return this.log("where's the accessory? inside _setupDevice");
  var device = accessory.miioDevice = miio.createDevice(accessory.context.miioInfo);

  accessory.context.implements = accessory.context.implements || {};
  var impl = accessory.context.implements;

  // check for capabilities
  device.getProperties([ 'power', 'mode', 'aqi', 'temp_dec', 'humidity' ]).then((info)=> {
    // if device reported a power state, we can actuate that
    if (info.power) impl.power = true;
    accessory.miioConfigured = true;
    // todo: recognise other characteristics and expose them as homekit characteristics too...
  }).catch((err)=> {
    accessory.updateReachability(false);
    accessory.miioConfigured = false;
    this.log("Miio device unreachable during setup: " + hostname, err);
  });

  if (impl.power) {
    (accessory.getService(Service.Switch, "Power") || accessory.addService(Service.Switch, "Power"))
    .getCharacteristic(Characteristic.On)
    .on('set', (value, callback)=> {
      this.log(hostname, "power to " + value);
      device.setPower(!!value).then(()=> callback()).catch(()=> callback("Communications Error"));
    }).on('get', (callback)=> {
      device.getProperties(['power'])
      .then((value)=> callback(null, {"on": 1, "off": 0}[value.power]))
      .catch(()=> callback("Communications Error"));
    });
  }

  // accessory.on('identify', (paired, callback)=> {
  //   this.log(accessory.displayName, "Identify!!!");
  //   callback();
  // });

  if (done) done();
}

XiaomiMiio.prototype.pollDevices = function() {
  for (let host in this.accessories) {
    let accessory = this.accessories[host];
    let queries = [];
    if (accessory.getService(Service.Switch, "Power")) queries.push("power");
    if (queries.length > 0) {
      accessory.miioDevice.getProperties(queries).then((props)=> {
        if (accessory.miioConfigured === false) this._setupDevice(host);
        accessory.updateReachability(true);
        if (props.power) accessory.getService(Service.Switch, "Power").updateCharacteristic(Characteristic.On, props.power == "on");
      }).catch(()=> {
        accessory.updateReachability(false);
      })
    }
  }
}

// Function invoked when homebridge tries to restore cached accessory
// Developer can configure accessory at here (like setup event handler)
// Update current value
XiaomiMiio.prototype.configureAccessory = function(accessory) {
  this.log(accessory.displayName, "Configure Accessory");
  var platform = this;

  accessory.reachable = false; // this gets updated automatically when mdns discovers it

  this.accessories[accessory.context.miioInfo.address] = accessory;
  this._setupDevice(accessory.context.miioInfo.address);
}

// Handler will be invoked when user try to config your plugin
// Callback can be cached and invoke when nessary
XiaomiMiio.prototype.configurationRequestHandler = function(context, request, callback) {
  this.log("Context: ", JSON.stringify(context));
  this.log("Request: ", JSON.stringify(request));

  // Check the request response
  if (request && request.response && request.response.inputs && request.response.inputs.name) {
    this.addAccessory(request.response.inputs.name);

    // Invoke callback with config will let homebridge save the new config into config.json
    // Callback = function(response, type, replace, config)
    // set "type" to platform if the plugin is trying to modify platforms section
    // set "replace" to true will let homebridge replace existing config in config.json
    // "config" is the data platform trying to save
    callback(null, "platform", true, {"platform":"XiaomiMiio", "otherConfig":"SomeData"});
    return;
  }

  // - UI Type: Input
  // Can be used to request input from user
  // User response can be retrieved from request.response.inputs next time
  // when configurationRequestHandler being invoked

  var respDict = {
    "type": "Interface",
    "interface": "input",
    "title": "Add Accessory",
    "items": [
      {
        "id": "name",
        "title": "Name",
        "placeholder": "Fancy Light"
      }//,
      // {
      //   "id": "pw",
      //   "title": "Password",
      //   "secure": true
      // }
    ]
  }

  // - UI Type: List
  // Can be used to ask user to select something from the list
  // User response can be retrieved from request.response.selections next time
  // when configurationRequestHandler being invoked

  // var respDict = {
  //   "type": "Interface",
  //   "interface": "list",
  //   "title": "Select Something",
  //   "allowMultipleSelection": true,
  //   "items": [
  //     "A","B","C"
  //   ]
  // }

  // - UI Type: Instruction
  // Can be used to ask user to do something (other than text input)
  // Hero image is base64 encoded image data. Not really sure the maximum length HomeKit allows.

  // var respDict = {
  //   "type": "Interface",
  //   "interface": "instruction",
  //   "title": "Almost There",
  //   "detail": "Please press the button on the bridge to finish the setup.",
  //   "heroImage": "base64 image data",
  //   "showActivityIndicator": true,
  // "showNextButton": true,
  // "buttonText": "Login in browser",
  // "actionURL": "https://google.com"
  // }

  // Plugin can set context to allow it track setup process
  context.ts = "Hello";

  //invoke callback to update setup UI
  callback(respDict);
}

// Sample function to show how developer can add accessory dynamically from outside event
XiaomiMiio.prototype.addAccessory = function(hostname, port) {
  this.log("Investigating Miio device at udp://" + hostname + ":" + port)
  // figure out what sort of accessory it is
  var miioInfo = miio.infoFromHostname(hostname);
  miioInfo.address = hostname;
  miioInfo.port = port;
  var accessoryName = miioInfo.id || "Miio Device";

  this.log("Miio Accessory detected: " + accessoryName);
  var platform = this;
  var uuid;

  uuid = UUIDGen.generate(hostname);

  var newAccessory = new Accessory(accessoryName, uuid);

  // store contact info for device in to accessory's perminant data
  newAccessory.context.miioInfo = miioInfo;

  // update serial number and stuff
  accessory.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, "Xiaomi")
    .setCharacteristic(Characteristic.Model, "Miio Device")
    .setCharacteristic(Characteristic.SerialNumber, miioInfo.id || `uuid:${uuid}`);

  this.accessories[hostname] = newAccessory;
  this._setupDevice(hostname, ()=> {
    this.api.registerPlatformAccessories("homebridge-miio", "XiaomiMiio", [newAccessory]);
  });
}
