const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  const filePath = path.join('C:\\Users\\Achraf\\Desktop\\AplicacionMovil', 'autorizar-wallet.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(data);
  });
});

server.listen(8765, () => console.log('Server running at http://localhost:8765'));
