**homebridge-miio** is a platform plugin for homebridge which lets you switch
Xiaomi Power Plugs on and off using Homekit apps and Siri.

It seems very reliable now, and should coexist happily with other Xiaomi home
automation ecosystem plugins. Eventually it would be nice to support some other
device types, if people who have those devices want to do pull requests, or
donate hardware, it'd surely be welcomed. You don't need to configure anything,
just install the platform plugin with `npm install -g homebridge-miio`. devices
on the same subnet as your homebridge server will be discovered at launch and
every half hour after that, and supported devices will be polled for changes
occasionally to keep things responsive.

Here's an example homebridge config file, you could use to tweak the default
settings. Numbers are presented in seconds. If you choose to disable
`pollChanges` you may see some inconsistency if you also control your miIO
devices via the Mi Home app (including via Mi Home app timers).

_Note that currently only the WiFi plugs are supported, not the gateway-based
ones operating over Zigbee, though this is likely to change in the future._

```json
{
  "bridge": {
    "name": "TestBridge",
    "username": "CC:22:3D:E3:CE:33",
    "port": 51826,
    "pin": "031-45-154"
  },

  "description": "Test Bridge",
  "accessories": [],
  "platforms": [
    {
      "platform" : "XiaomiMiio",
      "name" : "XiaomiMiio",
      "pollChanges": true,
      "pollInterval": 15,
      "searchInterval": 1800
    }
  ]
}
```
