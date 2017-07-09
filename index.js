const miio = require('miio');
const HKMiioVersion = require('./package.json').version;
var Accessory, Service, Characteristic, UUIDGen;
const SupportedTypes = {
  "outlet":true,
  "power-plug":true,
  "power-strip":true,
  "power-switch":true
};

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
  this.config = config || {};
  this.accessories = {};

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object.
    this.api = api;

    // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories
    // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
    // Or start discover new accessories
    this.api.on('didFinishLaunching', ()=> {
      platform.log("DidFinishLaunching");

      // remove any out of date accessories so they don't cause conflicts
      let outdatedAccessories = Object.keys(this.accessories)
        .map(k => this.accessories[k]).filter(a => a.context.miioVersion !== HKMiioVersion);
      this.api.unregisterPlatformAccessories("homebridge-miio", "XiaomiMiio", outdatedAccessories);
      outdatedAccessories.forEach(a => this.accessories[a.context.miioInfo.address] = null);

      // discover miio devices and then poll for new ones occasionally
      this.miioBrowser = miio.browse({cacheTime: this.config.searchInterval || 1800});
      this.miioBrowser.on('available', (info)=> {
        platform.log("device discovered", info.id)
        this.addAccessory(info);
        if (this.accessories[info.id])
          this.accessories[info.id].updateReachability(true);
      });
      this.miioBrowser.on('unavailable', (info)=> {
        if (this.accessories[info.id])
          this.accessories[info.id].updateReachability(false);
      });
      this.miioBrowser.on('update', (info)=> {
        this.addAccessory(info);
        if (this.accessories[info.id])
          this.accessories[info.id].updateReachability(true);
      });

      // start polling the Xiaomi devices on network for current status in case other things change them
      // if (!this.config || this.config.pollChanges !== false)
      //   setInterval(()=> this.pollDevices(), (this.config.pollInterval || 15) * 1000);
      this.pollDevices(this.config.pollChanges !== false);
    });
  }
}

// slowly query every known accessory for it's current state
XiaomiMiio.prototype.pollDevices = function(looping) {
  var accessories = Object.keys(this.accessories).map((id) => this.accessories[id]);
  var interval = ((this.config.pollInterval || 15) * 1000) / accessories.length;

  var loop = (list)=> {
    let accessory = list.shift();
    if (accessory && accessory.context) this.pollDevice(accessory);
    // wait before querying next device, to keep network load low and steady
    if (list.length > 0) {
      setTimeout(()=> loop(list), interval);
    } else if (looping) {
      setTimeout(()=> this.pollDevices(looping), interval);
    }
  }
  loop(accessories);
}

// query a specific accessory for updated state
XiaomiMiio.prototype.pollDevice = function(accessory, cb) {
  let queries = [];
  if (SupportedTypes[accessory.miioDevice.type]) queries = ["power"];
  accessory.miioDevice.loadProperties(queries)
  .then((props)=> {
    accessory.updateReachability(true);
    if (SupportedTypes[accessory.miioDevice.type]) {
      accessory.context.powerOn = !!props.powerChannel0;
      accessory.getService(Service.Outlet, "Power Plug")
               .updateCharacteristic(Characteristic.On, !!props.powerChannel0);
    } else {
      this.log("Unsupported accessory is somehow in homebridge database");
    }
    if (cb) cb();
  }).catch((err)=> {
    accessory.updateReachability(false);
    if (cb) cb(err);
    else this.log("poll update failed on " + accessory.context.miioInfo.id, err);
  });
}

// Function invoked when homebridge tries to restore cached accessory
// Developer can configure accessory at here (like setup event handler)
// Update current value
XiaomiMiio.prototype.configureAccessory = function(accessory) {
  this.log(accessory.displayName, "Configure Accessory");
  this.accessories[accessory.context.miioInfo.id] = accessory;

  // update serial number and stuff
  accessory.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, "Xiaomi")
    .setCharacteristic(Characteristic.Model, `v${HKMiioVersion}: ${accessory.context.miioInfo.model || "Unknown Device"}`)
    .setCharacteristic(Characteristic.SerialNumber, `${accessory.context.miioInfo.id}` || "Unknown");

  // create device api
  if (!accessory.context.miioInfo.model) this.log("model info missing");
  if (!accessory.miioDevice) accessory.miioDevice = miio.createDevice(accessory.context.miioInfo);

  // turn off monitoring feature of miio lib
  accessory.miioDevice.stopMonitoring();

  if (accessory.context.features.switchPlug) {
    var service = accessory.getService(Service.Outlet, "Power Plug") || accessory.addService(Service.Outlet, "Power Plug");
    var charOn = service.getCharacteristic(Characteristic.On)
    charOn.on('set', (value, callback)=> {
      this.log(accessory.displayName, "power to " + value);
      accessory.miioDevice.setPower(!!value).then(()=> {
        accessory.context.powerOn = !!value;
        callback();
      }).catch((err)=> {
        callback("Communications Error", err);
      });
    })
    charOn.on('get', (callback)=> {
      this.log(accessory.displayName, "fetch status")
      // return polled value immediately:
      callback(null, !!accessory.context.powerOn);
      // pull update lazily:
      this.pollDevice(accessory);
    });
    // we can't possibly know this, so we assume as best we can:
    service.updateCharacteristic(Characteristic.OutletInUse, true);
  } else {
    this.log("Mysteriously there is a device in here which isn't a switch...", accessory.context.miioType);
  }
}

// check a newly detected accessory and make sure it's in the bridge
XiaomiMiio.prototype.addAccessory = function(miioInfo) {
  this.log(`Investigating Miio Device at udp://${miioInfo.address}:${miioInfo.port}`);

  // check this device can be communicated with
  if (!miioInfo.token) {
    this.log("Device token is hidden, cannot add accessory");
    return;
  }

  // communicate with device to figure out what type it is
  miioInfo.writeOnly = true;
  miio.device(miioInfo).catch(err => this.log("Couldn't investigate device", miioInfo, err))
	.then((device)=> {
    var uuid = UUIDGen.generate(`miio.${device.model}.${miioInfo.id}`);
    var isNew = !this.accessories[miioInfo.id]; // does it need registering?

    if (SupportedTypes[device.type]) {
      if (isNew) {
        this.log("Miio Accessory is a switch plug. Adding to HomeKit");
        this.accessories[miioInfo.id] = new Accessory(`miIO Plug ${miioInfo.id}`, uuid);
      }
      this.accessories[miioInfo.id].context.features = {switchPlug: true};
    } else {
      this.log("Unsupported, ignoring");
    }

    if (this.accessories[miioInfo.id]) {
      let accessory = this.accessories[miioInfo.id];
      // store contact info for device in to accessory's permanent data
      accessory.context.miioInfo = miioInfo;
      accessory.context.miioInfo.model = device.model;
      accessory.context.miioVersion = HKMiioVersion;
      accessory.context.miioType = device.type;
      accessory.updateReachability(true);
      // update device object
      if (accessory.miioDevice) accessory.miioDevice.destroy();
      accessory.miioDevice = device;
      // register it if necessary
      if (isNew) {
        this.api.registerPlatformAccessories("homebridge-miio", "XiaomiMiio", [accessory]);
        this.configureAccessory(accessory);
      }
    } else {
      device.destroy();
    }
	});
}
