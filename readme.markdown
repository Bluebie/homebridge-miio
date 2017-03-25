**homebridge-miio** is a platform plugin for homebridge which lets you switch
Xiaomi Power Plugs on and off using Homekit apps and Siri.

It's early days, but it seems to work well with Xiaomi Power Plug v2. It might
work with other Xiaomi home automation ecosystem devices, if they implement a
"power" feature, and announce themselves over mdns/zeroconf. Some do not seem
to do this... If you have other devices, it would be great to get information
on how to support them, or better yet, code pull requests!

Currently there is some buggyness if you start homebridge while your plugs are
not online. As long as you avoid that situation, it should work!

Here's an example homebridge config file!

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
      "pollInterval": 15
    }
  ]
}
```

You can change the `pollChanges` to `false`, if you want to minimise network
traffic, but HomeKit might not notice if you turn the device on or off with the
a button or directly using a Xiaomi app. The pollInterval setting is in seconds,
and affects how much network traffic goes on constantly in the background.
