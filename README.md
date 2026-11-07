# Μονοπάτι — Setup & πρόσβαση από άλλες συσκευές

## Τοπική εκτέλεση (στον υπολογιστή σου)

```bash
cd backend
npm install
cp .env.example .env   # βάλε το δικό σου ANTHROPIC_API_KEY μέσα
npm start               # τρέχει στο http://localhost:3001
```

Σε άλλο terminal:
```bash
cd frontend
npx serve -p 5500       # ή: python3 -m http.server 5500
```
Άνοιξε: `http://localhost:5500`

---

## 📱 Πρόσβαση από κινητό (ίδιο WiFi) — έτοιμο ήδη

Ο κώδικας είναι πλέον έτοιμος να δουλέψει αυτόματα σε κινητό/tablet **στο ίδιο WiFi δίκτυο** με τον υπολογιστή σου, χωρίς καμία αλλαγή.

**Βήματα:**
1. Βρες την **τοπική IP** του υπολογιστή σου:
   - **Windows**: άνοιξε cmd, γράψε `ipconfig`, βρες το "IPv4 Address" (π.χ. `192.168.1.42`)
   - **Mac**: System Settings → Wi-Fi → Details, ή τρέξε `ifconfig | grep inet`
2. Βεβαιώσου ότι backend και frontend τρέχουν κανονικά (βήματα παραπάνω)
3. Στο κινητό (**ίδιο WiFi**), άνοιξε στον browser: `http://192.168.1.42:5500` (βάλε τη δική σου IP)
4. Η εφαρμογή θα φορτώσει, και θα μιλάει αυτόματα στο σωστό backend (`192.168.1.42:3001`) — το `app.js` το ανιχνεύει μόνο του

**Περιορισμός:** Δουλεύει μόνο όσο και οι δύο συσκευές είναι στο **ίδιο δίκτυο** — π.χ. σπίτι σου. Αν κλείσεις τον υπολογιστή ή αλλάξεις δίκτυο, σταματά.

---

## 🌍 Πρόσβαση από ΟΠΟΥΔΗΠΟΤΕ (πραγματικό internet, όχι μόνο το ίδιο WiFi)

Αυτό χρειάζεται πραγματικό **hosting** — δύο ξεχωριστά κομμάτια, και τα δύο με δωρεάν πλάνο διαθέσιμο:

### Βήμα 1: Backend → Render

1. Φτιάξε δωρεάν λογαριασμό στο [render.com](https://render.com)
2. "New +" → "Web Service" → σύνδεσε το GitHub repo σου (ανέβασε πρώτα τον φάκελο `backend/` σε ένα GitHub repository)
3. Ρυθμίσεις: **Build Command**: `npm install` · **Start Command**: `npm start`
4. Πρόσθεσε environment variable: `ANTHROPIC_API_KEY` = το δικό σου key
5. Deploy — θα πάρεις ένα URL σαν `https://monopati-backend.onrender.com`

### Βήμα 2: Frontend → Render Static Site (ή Netlify)

1. "New +" → "Static Site" → ίδιο repo, root directory `frontend/`
2. Deploy — θα πάρεις ένα URL σαν `https://monopati-app.onrender.com`

### Βήμα 3: Σύνδεσε τα δύο

Άνοιξε το `frontend/app.js`, βρες τη γραμμή:
```javascript
const PRODUCTION_API_BASE = null;
```
Άλλαξέ τη σε:
```javascript
const PRODUCTION_API_BASE = "https://monopati-backend.onrender.com/api";
```
(με το πραγματικό URL από το Βήμα 1), ξανά-ανέβασε το frontend.

**Τώρα η εφαρμογή είναι προσβάσιμη από ΟΠΟΙΑΔΗΠΟΤΕ συσκευή, οπουδήποτε στο internet**, μέσω του `https://monopati-app.onrender.com` link.

**Σημείωση για το δωρεάν πλάνο του Render**: ο server "κοιμάται" μετά από ~15 λεπτά αδράνειας — ο πρώτος επισκέπτης μετά από αυτό θα δει λίγα δευτερόλεπτα καθυστέρηση όσο ξυπνάει. Αν θες να το αποφύγεις εντελώς, το πληρωμένο "Starter" πλάνο (~$7/μήνα) το κρατάει πάντα ενεργό.
