const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY || '';

export function buildLocationPickerHtml(
  centerLat: number,
  centerLng: number,
  pin: { latitude: number; longitude: number } | null,
): string {
  const pinJs = pin
    ? `setPickerPin(${pin.latitude},${pin.longitude},false);`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:#0d1117;overflow:hidden;-webkit-tap-highlight-color:transparent}
#map{width:100%;height:100%;cursor:crosshair}
#pin{position:absolute;display:none;transform:translate(-50%,-100%);pointer-events:none;z-index:10}
#pin svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))}
</style>
</head>
<body>
<div id="map"></div>
<div id="pin">
  <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.667 16 26 16 26S32 26.667 32 16C32 7.163 24.837 0 16 0z" fill="#A78BFA"/>
    <circle cx="16" cy="16" r="7" fill="white"/>
  </svg>
</div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
var RN=window.ReactNativeWebView;
function post(o){try{if(RN){RN.postMessage(JSON.stringify(o));}else{window.parent.postMessage(JSON.stringify(o),'*');}}catch(e){}}

var pinEl=document.getElementById('pin');
var pinMarker=null;

var map=new maplibregl.Map({
  container:'map',
  style:'https://api.maptiler.com/maps/streets-v4/style.json?key=${encodeURIComponent(MAPTILER_KEY)}',
  center:[${centerLng},${centerLat}],
  zoom:14,
  attributionControl:true,
  fadeDuration:200,
});

window.setPickerPin=function(lat,lng,fly){
  if(pinMarker){pinMarker.remove();}
  var el=document.createElement('div');
  el.style.cssText='width:32px;height:42px;cursor:default;';
  el.innerHTML=pinEl.innerHTML;
  pinMarker=new maplibregl.Marker({element:el,anchor:'bottom'})
    .setLngLat([lng,lat]).addTo(map);
  if(fly){map.flyTo({center:[lng,lat],zoom:15,duration:600});}
};

map.on('click',function(e){
  var lat=e.lngLat.lat,lng=e.lngLat.lng;
  window.setPickerPin(lat,lng,false);
  post({type:'pinDrop',lat:lat,lng:lng});
});

map.on('error',function(){post({type:'mapError'});});
map.on('load',function(){
  ${pinJs}
  post({type:'ready'});
});
</script>
</body>
</html>`;
}

