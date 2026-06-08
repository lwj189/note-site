const fs = require('fs');

// 1. Fix /api/notebooks route
let s = fs.readFileSync('D:/note-site/server.js', 'utf-8');
const old = `app.get('/api/notebooks', (req, res) => {
  const notebooks = loadNotebooks();
  const notes = loadActiveNotes();
  // Return notebooks with note counts
  const result = notebooks.map(name => ({
    name,
    count: notes.filter(n => n.tags && n.tags.includes(name)).length
  }));
  res.json(result);
});`;

const newer = `app.get('/api/notebooks', (req, res) => {
  const notebooks = loadNotebooks();
  const notes = loadActiveNotes();
  // Return notebooks with note counts and metadata
  const result = notebooks.map(nb => {
    const name = typeof nb === 'string' ? nb : nb.name;
    return {
      name,
      color: typeof nb === 'string' ? '#4361ee' : (nb.color || '#4361ee'),
      icon: typeof nb === 'string' ? '\uD83D\uDCC1' : (nb.icon || '\uD83D\uDCC1'),
      count: notes.filter(n => n.tags && n.tags.includes(name)).length
    };
  });
  res.json(result);
});`;

s = s.replace(old, newer);
fs.writeFileSync('D:/note-site/server.js', s, 'utf-8');
console.log('1. /api/notebooks fixed');

// 2. Fix sidebar notebook rendering in app.js to show color + icon
let app = fs.readFileSync('D:/note-site/public/app.js', 'utf-8');

app = app.replace(
  "'<a href=\"/notebook/' + encodeURIComponent(nb.name) + '\" class=\"sidebar-notebook-item\">' +",
  "'<a href=\"/notebook/' + encodeURIComponent(nb.name) + '\" class=\"sidebar-notebook-item\" style=\"border-left-color:' + (nb.color || '#4361ee') + '\">' +"
);

app = app.replace(
  "'<span class=\"notebook-name\">' + nb.name.replace(/</g, '&lt;') + '</span>' +",
  "'<span class=\"notebook-name\">' + (nb.icon || '\uD83D\uDCC1') + ' ' + nb.name.replace(/</g, '&lt;') + '</span>' +"
);

fs.writeFileSync('D:/note-site/public/app.js', app, 'utf-8');
console.log('2. Sidebar notebooks fixed');

console.log('Done');
