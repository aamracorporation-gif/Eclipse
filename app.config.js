module.exports=({config:base})=>{
 const config={...base,...require('./app.json').expo,ios:{...require('./app.json').expo.ios}};
 if(process.env.EAS_REUSE_ECLIPSE==='true'){
  if(!/^https:\/\//.test(process.env.EXPO_PUBLIC_API_URL||''))throw new Error('TestFlight requiere la URL HTTPS del backend verificado.');
  config.owner='ashhhhhhhh';config.slug='Eclipse';config.version='1.1.0';
  config.ios.bundleIdentifier='com.achraf.eclipse';
  config.ios.buildNumber='78';
  config.ios.infoPlist={...(config.ios.infoPlist||{}),ITSAppUsesNonExemptEncryption:false};
  config.extra={...(config.extra||{}),eas:{projectId:'42ebb6eb-62b1-4784-a483-831ae3c804f2'}};
 }
 return config;
};
