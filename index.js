// for discovering miio devices that advertise over MDNS
const mdns = require('mdns');
const miio = require('miio');
const HKMiioVersion = require('./package.json').version;
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
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
          //if (this.accessories[service.host].miioConfigured == false) this._setupDevice(service.host);
          this.accessories[service.host].updateReachability(true);
        }
      });
      browser.on('serviceDown', (service)=> {
        if (this.accessories[service.host]) this.accessories[service.host].updateReachability(false);
      });
      browser.start();

      // start polling the Xiaomi devices on network for current status in case other things change them
      if (!this.config || this.config.pollChanges !== false)
        setInterval(()=> this.pollDevices(), ((this.config || {}).pollInterval || 15) * 1000);
      this.pollDevices();
    });
  }
}

XiaomiMiio.prototype.pollDevices = function() {
  for (let host in this.accessories) {
    let accessory = this.accessories[host];
    let queries = [];
    if (accessory.context.features.switch) queries.push("power");
    if (queries.length > 0) {
      accessory.miioDevice.getProperties(queries).then((props)=> {
        //this.log(accessory.displayName, "state update:", props);
        accessory.updateReachability(true);
        if (props.power !== undefined) {
          accessory.getService(Service.Switch, "Power")
                   .updateCharacteristic(Characteristic.On, props.power);
        }
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

  // remove legacy entries
  if (accessory.context.version !== HKMiioVersion) {
    this.api.unregisterPlatformAccessories("homebridge-miio", "XiaomiMiio", [accessory]);
    return;
  }

  this.accessories[accessory.context.miioInfo.address] = accessory;

  // create device api
  if (!accessory.miioDevice) accessory.miioDevice = miio.createDevice(accessory.context.miioInfo);
  var device = accessory.miioDevice;

  accessory.miioDevice.stopMonitoring(); // turn off monitoring feature of miio lib

  if (accessory.context.features.switch) {
    (accessory.getService(Service.Switch, "Power") || accessory.addService(Service.Switch, "Power"))
    .getCharacteristic(Characteristic.On)
    .on('set', (value, callback)=> {
      this.log(accessory.displayName, "power to " + value);
      device.setPower(!!value).then(()=> callback()).catch(()=> callback("Communications Error"));
    }).on('get', (callback)=> {
      this.log(accessory.displayName, "fetch status")
      device.getProperties(['power'])
      .then((value)=> callback(null, value.power))
      .catch(()=> callback("Communications Error"));
    });
  }
}

// Sample function to show how developer can add accessory dynamically from outside event
XiaomiMiio.prototype.addAccessory = function(hostname, port) {
  this.log("Investigating Miio Device at udp://" + hostname + ":" + port)
  // figure out what sort of accessory it is
  var miioInfo = miio.infoFromHostname(hostname);
  miioInfo.address = hostname;
  miioInfo.port = port;
  var uuid = UUIDGen.generate(hostname);
  var accessory = false;

  if (miioInfo.model.match(/chuangmi-plug/)) {
    this.log("Miio Accessory is a switch plug. Adding to HomeKit");
    accessory = new Accessory(miioInfo.id || "Miio Switch", uuid);
    accessory.context.features = {"switch": true};
  } else {
    this.log("Unsupported, ignoring");
    return;
  }

  // store contact info for device in to accessory's perminant data
  accessory.context.miioInfo = miioInfo;
  accessory.context.version = HKMiioVersion;

  // update serial number and stuff
  accessory.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, "Xiaomi")
    .setCharacteristic(Characteristic.Model, miioInfo.model || "Miio Device")
    .setCharacteristic(Characteristic.SerialNumber, miioInfo.id || `uuid:${uuid}`);

  this.accessories[hostname] = accessory;
  this.api.registerPlatformAccessories("homebridge-miio", "XiaomiMiio", [accessory]);
  this.configureAccessory(accessory);
}
