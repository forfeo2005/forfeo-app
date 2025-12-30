const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
const OpenAI = require('openai');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Config OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// BASE DE CONNAISSANCES IA (Intégrée ici pour éviter les erreurs de fichier)
const knowledgeBase = `
TU ES FORFY : L'assistant IA officiel de FORFEO LAB.
TON RÔLE : Aider Ambassadeurs, Entreprises et Employés. Tu es pro, expert et sympa.

STRUCTURE :
- Ambassadeur : Réalise des Audits Mystères (visite terrain) ou des Sondages (par courriel). Il est payé par mission.
- Entreprise : Publie des audits, commande des sondages, gère ses employés.
- Admin : Valide les rapports et effectue les paiements.

TYPES DE MISSIONS :
1. Rapport d'Expérience (Standard) : Visite incognito, note /10.
2. Audit Qualité : Critères précis (Propreté, Accueil).
3. Sondage Satisfaction : L'ambassadeur envoie un mail au client final pour avoir son avis.

RÈGLE : Utilise le CONTEXTE fourni (nom, gains, missions) pour personnaliser ta réponse.
`;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// Middleware Statique (Inclut le dossier 'images' à la racine pour votre logo)
app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v11_ultimate_fix',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- SETUP BDD ---
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium');
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1));
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // Migrations de sécurité (Ajout colonnes si manquantes)
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_paiement TIMESTAMP;`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut_paiement VARCHAR(50) DEFAULT 'non_paye';`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS google_map_link TEXT;`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_email VARCHAR(255);`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_nom VARCHAR(255);`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS adresse VARCHAR(255);`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS type_audit VARCHAR(100) DEFAULT 'Audit Standard';`);
        await pool.query(`ALTER TABLE formations_modules ADD COLUMN IF NOT EXISTS image_icon VARCHAR(50);`);
        await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_module') THEN ALTER TABLE formations_scores ADD CONSTRAINT unique_user_module UNIQUE (user_id, module_id); END IF; END $$;`);

        // Seed Modules
        const modules = [
            { id: 1, titre: "Excellence du Service Client", desc: "Créer un effet WOW.", icon: "bi-emoji-smile", duree: "30 min" },
            { id: 2, titre: "Communication & Écoute Active", desc: "Le ton et l'empathie.", icon: "bi-ear", duree: "40 min" },
            { id: 3, titre: "Gestion des Situations Difficiles", desc: "Calmer le jeu.", icon: "bi-shield-check", duree: "45 min" },
            { id: 4, titre: "Culture Qualité & Feedback", desc: "S'améliorer continu.", icon: "bi-graph-up-arrow", duree: "25 min" },
            { id: 5, titre: "Professionnalisme & Collaboration", desc: "Image de marque.", icon: "bi-people", duree: "35 min" }
        ];
        for (const m of modules) {
            await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET titre = $2, description = $3, image_icon = $4, duree = $5`, [m.id, m.titre, m.desc, m.icon, m.duree]);
        }
        
        // Seed Questions
        const count = await pool.query("SELECT COUNT(*) FROM formations_questions");
        if (parseInt(count.rows[0].count) < 75) {
            await pool.query("TRUNCATE formations_questions RESTART IDENTITY CASCADE");
            for(let i=1; i<=5; i++) { for(let q=1; q<=15; q++) { await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte) VALUES ($1, 'Question ${q} Mod ${i}', 'A', 'B', 'C', 'B')`, [i]); }}
        }
        console.log("✅ FORFEO LAB : Prêt.");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// --- ROUTES BASE ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// --- API IA FORFY ---
app.post('/api/chat', async (req, res) => {
    try {
        const userMsg = req.body.message;
        const userId = req.session.userId;
        let context = "Utilisateur visiteur.";

        if(userId) {
            const user = await pool.query("SELECT nom, role FROM users WHERE id = $1", [userId]);
            context = `Utilisateur: ${user.rows[0].nom} (${user.rows[0].role}). `;
            
            if(user.rows[0].role === 'ambassadeur') {
                const gains = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [userId]);
                const missions = await pool.query("SELECT titre, statut FROM missions WHERE ambassadeur_id = $1", [userId]);
                context += `Gains totaux: ${gains.rows[0].total || 0}$. Ses missions: ${JSON.stringify(missions.rows)}.`;
            } else if (user.rows[0].role === 'entreprise') {
                const audits = await pool.query("SELECT titre, statut FROM missions WHERE entreprise_id = $1", [userId]);
                context += `Audits publiés: ${JSON.stringify(audits.rows)}.`;
            }
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: `${knowledgeBase}\n\nCONTEXTE ACTUEL:\n${context}` },
                { role: "user", content: userMsg }
            ],
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (err) { res.json({ reply: "Je suis temporairement indisponible." }); }
});

// --- AUTH ---
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null, userName: null }));
app.post('/login', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [req.body.email]);
        if (result.rows.length > 0 && await bcrypt.compare(req.body.password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.redirect('/login?error=Identifiants_invalides');
    } catch (e) { res.redirect('/login?error=Erreur_Systeme'); }
});
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur', error: null, userName: null }));
app.post('/register', async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [req.body.nom, req.body.email, hash, req.body.role]);
        res.redirect('/login?msg=Compte_cree');
    } catch (err) { res.redirect('/register?error=Email_existe_deja'); }
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const aPayer = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut = 'approuve' AND statut_paiement = 'non_paye'");
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye' ORDER BY m.date_paiement DESC`);
    res.render('admin-dashboard', { missions: missions.rows, users: users.rows, paiements: paiements.rows, totalAPayer: aPayer.rows[0].total || 0, userName: req.session.userName });
});
app.get('/admin/rapport/:missionId', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const data = await pool.query(`SELECT r.*, m.titre, m.type_audit, m.client_email, m.id as mission_id, u.nom as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1`, [req.params.missionId]);
    if(data.rows.length === 0) return res.send("Aucun rapport.");
    res.render('admin-rapport-detail', { rapport: data.rows[0], details: data.rows[0].details, userName: req.session.userName });
});
app.post('/admin/approuver-mission', async (req, res) => {
    const mission = await pool.query("SELECT statut FROM missions WHERE id = $1", [req.body.id_mission]);
    let newStatut = 'actif';
    if(mission.rows[0].statut === 'soumis') newStatut = 'approuve';
    await pool.query("UPDATE missions SET statut = $1 WHERE id = $2", [newStatut, req.body.id_mission]);
    res.redirect('/admin/dashboard?msg=Approuve');
});
app.post('/admin/payer-ambassadeur', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    await pool.query("UPDATE missions SET statut_paiement = 'paye', date_paiement = NOW() WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard?msg=Paiement_Enregistre');
});
app.post('/admin/rejeter-rapport', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    await pool.query("DELETE FROM audit_reports WHERE mission_id = $1", [req.body.id_mission]);
    await pool.query("UPDATE missions SET statut = 'actif', ambassadeur_id = NULL WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard?msg=Rapport_Rejete');
});

// --- ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom, m.titre, s.* FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1`, [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { user: user.rows[0], employeesScores: scores.rows, missions: missions.rows, userName: req.session.userName });
});
app.post('/entreprise/creer-audit', async (req, res) => {
    const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(req.body.adresse)}`;
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, adresse, google_map_link) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", 
    [req.session.userId, req.body.titre, req.body.type_audit, "Visite terrain.", req.body.recompense, req.body.adresse, mapLink]);
    res.redirect('/entreprise/dashboard?msg=Publie');
});
app.post('/entreprise/commander-sondage', async (req, res) => {
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, client_nom, client_email) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", 
    [req.session.userId, "Sondage : " + req.body.client_nom, req.body.type_sondage, "Enquête client.", req.body.recompense, req.body.client_nom, req.body.client_email]);
    res.redirect('/entreprise/dashboard?msg=Sondage_Commande');
});
app.post('/entreprise/supprimer-mission', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    await pool.query("DELETE FROM missions WHERE id = $1 AND entreprise_id = $2", [req.body.id_mission, req.session.userId]);
    res.redirect('/entreprise/dashboard?msg=Supprime');
});
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const query = `SELECT r.details, m.titre, m.type_audit, m.created_at, COALESCE(u.nom, 'Ambassadeur') as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1 AND m.entreprise_id = $2`;
    const report = await pool.query(query, [req.params.id, req.session.userId]);
    if(report.rows.length === 0) return res.send("Rapport non disponible.");
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(20).text('RAPPORT', {align:'center'});
    doc.moveDown();
    const details = report.rows[0].details;
    if (details) { for (const [key, value] of Object.entries(details)) { doc.font('Helvetica-Bold').text(`${key}:`); doc.font('Helvetica').text(`${value}`); doc.moveDown(0.5); } }
    doc.end();
});

// --- AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    const historique = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    const gains = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: missions.rows, historique: historique.rows, totalGains: gains.rows[0].total || 0, userName: req.session.userName });
});
app.post('/ambassadeur/postuler', async (req, res) => {
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, req.body.id_mission]);
    res.redirect('/ambassadeur/dashboard');
});
app.post('/ambassadeur/soumettre-rapport', async (req, res) => {
    const { mission_id, ...reponses } = req.body;
    await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1, $2, $3) ON CONFLICT (mission_id) DO UPDATE SET details = $3", 
        [mission_id, req.session.userId, JSON.stringify(reponses)]);
    await pool.query("UPDATE missions SET statut = 'soumis' WHERE id = $1", [mission_id]);
    res.redirect('/ambassadeur/dashboard?msg=Soumis');
});

// --- PROFIL ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null });
});
app.post('/profil/update', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await pool.query("UPDATE users SET nom = $1, email = $2 WHERE id = $3", [req.body.nom, req.body.email, req.session.userId]);
    if(req.body.new_password) {
        const hash = await bcrypt.hash(req.body.new_password, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    }
    req.session.userName = req.body.nom;
    res.redirect('/profil?msg=Profil_mis_a_jour');
});
app.post('/profil/delete', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await pool.query("DELETE FROM users WHERE id = $1", [req.session.userId]);
    req.session.destroy();
    res.redirect('/?msg=Compte_supprime');
});

app.listen(port, () => console.log(`🚀 LIVE`));
