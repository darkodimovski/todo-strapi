# Deploy: OVH VPS (backend) + Netlify (frontend)

| Dio | Gdje | Cijena |
|---|---|---|
| Strapi + baza (SQLite) + push + cron | OVH VPS-1, Ubuntu 26.04, Docker | ~5–7 €/mj |
| HTTPS za API | Caddy + Let's Encrypt (automatski) | 0 € |
| Adresa za API | DuckDNS, npr. `bo-todo-api.duckdns.org` | 0 € |
| Frontend (PWA) | Netlify, npr. `bo-todo.netlify.app` | 0 € |

Tajne (ključevi, lozinke) nastaju **na serveru** skriptom i nikad ne idu u git ni u chat.

---

## 1. Netlify – frontend (5 min)

1. Pushaj `todo-frontend` na GitHub.
2. [app.netlify.com](https://app.netlify.com) → prijava s GitHubom → **Add new site → Import an existing project** → odaberi `todo-frontend`.
   Postavke builda se čitaju iz `netlify.toml`, ništa ne mijenjaj.
3. **Site configuration → Change site name** → npr. `bo-todo` → adresa je `https://bo-todo.netlify.app`.
4. **Site configuration → Environment variables → Add**:
   `REACT_APP_API_URL` = `https://bo-todo-api.duckdns.org` (adresa iz koraka 2)
5. **Deploys → Trigger deploy → Deploy site.**

## 2. DuckDNS – adresa za API (2 min)

1. [duckdns.org](https://www.duckdns.org) → prijava (npr. Google).
2. Upiši poddomenu, npr. `bo-todo-api` → **add domain**.
3. Kad dobiješ VPS, u polje **current ip** upiši IP servera → **update ip**.

## 3. VPS – priprema servera (10 min)

Prijava (IP i lozinku OVH šalje mailom), u PowerShellu na laptopu:

```bash
ssh ubuntu@IP_SERVERA
```

Na serveru:

```bash
sudo apt update && sudo apt upgrade -y
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Ponovno se prijavi (`ssh ubuntu@IP_SERVERA`) da grupa `docker` vrijedi.

## 4. Backend na serveru (15 min, prvi build traje nekoliko minuta)

```bash
sudo mkdir -p /opt/todo-strapi && sudo chown $USER /opt/todo-strapi
git clone https://github.com/<tvoj-github>/todo-strapi.git /opt/todo-strapi
cd /opt/todo-strapi
bash scripts/init-env.sh
docker compose up -d --build
```

- Ako je repozitorij **privatan**, `git clone` traži prijavu: kao lozinku upiši GitHub *Personal access token* (GitHub → Settings → Developer settings → Fine-grained tokens, samo čitanje ovog repozitorija).
- `init-env.sh` pita: adresu API-ja (`bo-todo-api.duckdns.org`), adresu frontenda (`https://bo-todo.netlify.app`), mail za push i (opcionalno) Gmail + *App password* za slanje mailova.

Provjera: `https://bo-todo-api.duckdns.org/admin` mora otvoriti Strapi admin s lokotom (HTTPS).
Logovi: `docker compose logs -f strapi`

## 5. Prijenos podataka s laptopa (10 min)

1. Na laptopu **zaustavi lokalni Strapi** (da baza bude u mirnom stanju).
2. U PowerShellu na laptopu:

```bash
ssh ubuntu@IP_SERVERA "mkdir -p ~/import"
```

```bash
scp C:\Coding\todo-strapi\.tmp\data.db ubuntu@IP_SERVERA:~/import/data.db
```

```bash
scp -r C:\Coding\todo-strapi\public\uploads ubuntu@IP_SERVERA:~/import/uploads
```

3. Na serveru:

```bash
cd /opt/todo-strapi && bash scripts/import-local-data.sh
```

Svi se prijavljuju **istim lozinkama** kao lokalno. Obavijesti svatko ponovno uključi na zvoncu (nova adresa = nova pretplata).

## 6. Backup svaku noć

```bash
crontab -e
```

Dodaj red:

```
30 2 * * * cd /opt/todo-strapi && bash scripts/backup.sh >> backups/backup.log 2>&1
```

Backupi su u `/opt/todo-strapi/backups` (14 dana). Povremeno ih skini na laptop:

```bash
scp -r ubuntu@IP_SERVERA:/opt/todo-strapi/backups C:\Backup\todo
```

## 7. Ažuriranja

- **Frontend:** `git push` → Netlify sam deploya.
- **Backend:** na serveru
  ```bash
  cd /opt/todo-strapi && git pull && docker compose up -d --build
  ```

## 8. Provjera nakon deploya

- [ ] `https://bo-todo.netlify.app` → prijava radi, vide se todoi i fotografije
- [ ] Zvonce → *Enable notifications* → stiže probna obavijest
- [ ] Mobitel: Android Chrome *Instaliraj aplikaciju* / iPhone Safari *Dodaj na početni zaslon* → prijava → zvonce
- [ ] Dodijeli todo drugom korisniku → stiže alert
- [ ] `https://bo-todo-api.duckdns.org/api/todos` bez prijave vraća **403** (podaci nisu javni)

## Ako nešto ne radi

| Problem | Rješenje |
|---|---|
| Nema HTTPS-a / certifikat | DuckDNS IP mora biti IP servera; portovi 80 i 443 otvoreni (`sudo ufw status`); `docker compose logs caddy` |
| Frontend: "Login failed" / CORS greška | `CORS_ORIGINS` u `.env` mora biti točna Netlify adresa (bez `/` na kraju) → `docker compose up -d` |
| Frontend zove localhost | `REACT_APP_API_URL` nije postavljen na Netlifyju → postavi i ponovno deployaj |
| Strapi se ruši | `docker compose logs strapi` |
