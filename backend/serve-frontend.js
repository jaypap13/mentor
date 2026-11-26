// Σερβίρει τον φάκελο frontend/ στη θύρα 3000, για τοπική χρήση (και από κινητό στο ίδιο WiFi).
// Τρέχει με Node, που το Τείχος προστασίας των Windows ήδη επιτρέπει.
const express = require("express");
const path = require("path");

const PORT = process.env.FRONTEND_PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, "..", "frontend"), { extensions: ["html"], etag: false, lastModified: false, setHeaders: (res) => res.set("Cache-Control", "no-cache") }));
app.listen(PORT, () => console.log(`✅ Frontend τρέχει στο http://localhost:${PORT}`));
