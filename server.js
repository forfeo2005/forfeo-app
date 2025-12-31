const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const multer = require('multer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// CONFIGURATION UPLOAD (Stockage en mémoire pour la BDD)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CONFIGURATION EMAIL
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // Utiliser TLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// --- DONNÉES ACADÉMIE ---
const ACADEMY_DATA = [
    {
        id: 1, titre: "Excellence du Service Client", description: "Créer un effet WOW et fidéliser.", icon: "bi-emoji-smile", duree: "20 min",
        questions: [
            { q: "Un client entre alors que vous êtes au téléphone. Quelle est la meilleure réaction ?", a: "L'ignorer jusqu'à la fin de l'appel.", b: "Lui faire un signe de tête et sourire pour valider sa présence.", c: "Raccrocher au nez de votre interlocuteur.", rep: "B", sit: "Situation : Vous êtes occupé au téléphone." },
            { q: "La règle du 10-4 (10 pieds, 4 pieds) signifie :", a: "À 10 pieds je souris, à 4 pieds je salue verbalement.", b: "Je reste à 10 pieds du client.", c: "Je dois servir le client en 4 minutes.", rep: "A", sit: "Concept : Proactivité." },
            { q: "Un client régulier arrive. Vous connaissez son nom.", a: "Bonjour Monsieur !", b: "Bonjour M. Tremblay ! Ravi de vous revoir.", c: "Suivant !", rep: "B", sit: "Concept : Personnalisation." },
            { q: "Le client vous pose une question dont vous ignorez la réponse.", a: "Je ne sais pas.", b: "Ce n'est pas mon département.", c: "Excellente question, je vérifie pour vous immédiatement.", rep: "C", sit: "Situation : Demande technique." },
            { q: "Quelle est la dernière étape d'une interaction client réussie ?", a: "Donner la facture.", b: "Le remerciement sincère et l'invitation à revenir.", c: "Tourner le dos pour ranger.", rep: "B", sit: "Concept : La conclusion (Last impression)." }
        ]
    },
    {
        id: 2, titre: "Communication & Écoute Active", description: "Le ton, l'empathie et la reformulation.", icon: "bi-ear", duree: "25 min",
        questions: [
            { q: "L'écoute active, c'est principalement :", a: "Préparer sa réponse pendant que l'autre parle.", b: "Écouter pour comprendre, sans interrompre, et reformuler.", c: "Hocher la tête sans écouter.", rep: "B", sit: "Concept : Écoute." },
            { q: "Le langage non-verbal (corps, visage) représente quel % du message ?", a: "Environ 7%", b: "Environ 55%", c: "0%", rep: "B", sit: "Concept : Communication non-verbale." },
            { q: "Si un client parle vite et semble pressé, vous devez :", a: "Parler très lentement pour le calmer.", b: "Adapter votre rythme (Matching) pour être efficace.", c: "Lui dire de se calmer.", rep: "B", sit: "Technique : Le miroir." },
            { q: "Laquelle est une phrase d'empathie ?", a: "Calmez-vous.", b: "C'est pas de ma faute.", c: "Je comprends votre frustration, regardons cela ensemble.", rep: "C", sit: "Situation : Client déçu." },
            { q: "Pourquoi reformuler la demande du client ?", a: "Pour gagner du temps.", b: "Pour valider qu'on a bien compris son besoin.", c: "Pour montrer qu'on est intelligent.", rep: "B", sit: "Technique : Reformulation." }
        ]
    },
    {
        id: 3, titre: "Gestion des Situations Difficiles", description: "Gérer les plaintes et calmer le jeu.", icon: "bi-shield-exclamation", duree: "30 min",
        questions: [
            { q: "La méthode L.A.T.T.E pour gérer une plainte signifie :", a: "Listen, Acknowledge, Take action, Thank, Explain.", b: "Late, Angry, Tired, Terrible, End.", c: "Leave, Ask, Tell, Take, Exit.", rep: "A", sit: "Méthode : Starbucks LATTE." },
            { q: "Face à un client qui crie, vous devez :", a: "Crier plus fort pour dominer.", b: "Rester calme, parler doucement et écouter.", c: "L'ignorer.", rep: "B", sit: "Situation : Agressivité." },
            { q: "Un client demande un remboursement refusé par la politique.", a: "C'est non.", b: "C'est la politique, je n'y peux rien.", c: "Je ne peux pas rembourser, mais voici ce que je peux faire (alternative).", rep: "C", sit: "Technique : Le Non Positif." },
            { q: "Si un client vous insulte personnellement :", a: "Vous l'insultez aussi.", b: "Vous fixez une limite calmement : 'Je veux vous aider, mais je n'accepte pas ce langage'.", c: "Vous pleurez.", rep: "B", sit: "Situation : Harcèlement." },
            { q: "Après avoir résolu un conflit, il faut :", a: "En parler à tous les collègues pour rire.", b: "Oublier.", c: "S'assurer que le client part apaisé et satisfait (Récupération).", rep: "C", sit: "Concept : Récupération de service." }
        ]
    },
    {
        id: 4, titre: "Culture Qualité & Feedback", description: "L'amélioration continue et le souci du détail.", icon: "bi-gem", duree: "20 min",
        questions: [
            { q: "Un détail (papier par terre) nuit-il à l'expérience ?", a: "Non, le client ne le verra pas.", b: "Oui, tout communique une image de marque.", c: "Seulement si le patron est là.", rep: "B", sit: "Concept : Souci du détail." },
            { q: "Le feedback d'un client est :", a: "Une attaque personnelle.", b: "Un cadeau pour s'améliorer.", c: "Une perte de temps.", rep: "B", sit: "Attitude : Réception du feedback." },
            { q: "La constance dans le service signifie :", a: "Être bon une fois sur deux.", b: "Offrir la même excellence à chaque client, chaque jour.", c: "Être toujours moyen.", rep: "B", sit: "Concept : Standards." },
            { q: "Si vous voyez une erreur d'un collègue devant un client :", a: "Vous le chicanez devant le client.", b: "Vous corrigez discrètement ou en parlez après.", c: "Vous riez.", rep: "B", sit: "Savoir-vivre : Correction." },
            { q: "Qui est responsable de la qualité ?", a: "Le patron.", b: "Le gérant.", c: "Tout le monde.", rep: "C", sit: "Culture : Responsabilisation." }
        ]
    },
    {
        id: 5, titre: "Professionnalisme & Collaboration", description: "Image de marque et travail d'équipe.", icon: "bi-people", duree: "20 min",
        questions: [
            { q: "La ponctualité est :", a: "Optionnelle.", b: "Une forme de respect envers l'équipe et les clients.", c: "Pas grave si on est performant.", rep: "B", sit: "Savoir-être : Respect." },
            { q: "L'uniforme et l'apparence :", a: "Ne comptent pas.", b: "Sont le premier reflet de la marque.", c: "Sont pour faire joli.", rep: "B", sit: "Image : Présentation." },
            { q: "Si c'est le 'rush' et qu'un collègue est débordé :", a: "Tant pis pour lui.", b: "Je lui propose mon aide dès que je suis libre.", c: "Je prends une pause.", rep: "B", sit: "Valeur : Entraide." },
            { q: "L'utilisation du cellulaire personnel devant les clients :", a: "Est acceptée.", b: "Donne une image de désintérêt et est à éviter.", c: "Est cool.", rep: "B", sit: "Comportement : Focus client." },
            { q: "Parler en mal de l'entreprise en public :", a: "Est normal.", b: "Manque de loyauté et nuit à la réputation.", c: "Est drôle.", rep: "B", sit: "Éthique : Loyauté." }
        ]
    }
];

// --- TEMPLATES DE SONDAGES ---
const SURVEY_TEMPLATES = {
    "Restaurant": [
        { id: "accueil", text: "Comment avez-vous trouvé l'accueil ?", type: "stars" },
        { id: "qualite", text: "La qualité des plats ?", type: "stars" },
        { id: "service", text: "Le service était-il rapide ?", type: "yesno" },
        { id: "comment_gen", text: "Commentaires généraux / Suggestions", type: "text" }
    ],
    "Hôtel": [
        { id: "proprete", text: "Propreté de la chambre ?", type: "stars" },
        { id: "confort", text: "Confort de la literie ?", type: "stars" },
        { id: "personnel", text: "L'équipe a-t-elle été utile ?", type: "stars" },
        { id: "comment_gen", text: "Commentaires généraux / Suggestions", type: "text" }
    ],
    "Magasin": [
        { id: "trouve", text: "Avez-vous trouvé vos produits ?", type: "yesno" },
        { id: "conseil", text: "Qualité des conseils ?", type: "stars" },
        { id: "prix", text: "Rapport qualité/prix ?", type: "stars" },
        { id: "comment_gen", text: "Commentaires généraux / Suggestions", type: "text" }
    ],
    "Général": [
        { id: "global", text: "Votre satisfaction globale ?", type: "stars" },
        { id: "recommandation", text: "Nous recommanderiez-vous ?", type: "yesno" },
        { id: "comment_gen", text: "Commentaires généraux / Suggestions", type: "text" }
    ]
};

const knowledgeBase = `Tu es Forfy, IA de Forfeo Lab.`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v46_saas_final',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// DB SETUP
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium', telephone VARCHAR(50), adresse TEXT, logo_data TEXT);
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, date_expiration TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS sondages_publics (id SERIAL PRIMARY KEY, entreprise_id INTEGER, type_activite VARCHAR(50), reponses JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);
        
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_data TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_expiration TIMESTAMP");

        const countQ = await pool.query("SELECT COUNT(*) FROM formations_questions");
        await pool.query("TRUNCATE formations_questions RESTART IDENTITY CASCADE");
        await pool.query("TRUNCATE formations_modules RESTART IDENTITY CASCADE");
        
        for (const mod of ACADEMY_DATA) {
            await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5)`, [mod.id, mod.titre, mod.description, mod.icon, mod.duree]);
            for (const q of mod.questions) {
                await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation, explication) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [mod.id, q.q, q.a, q.b, q.c, q.rep, q.sit, "Standard"]);
            }
        }
        console.log("✅ DB & Académie Prêtes");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// ROUTES DE BASE
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/a-propos', (req, res) => res.render('a-propos', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// AUTH
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null, userName: null }));
app.post('/login', async (req, res) => {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [req.body.email]);
    if (result.rows.length > 0 && await bcrypt.compare(req.body.password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login?error=1');
});
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur', error: null, userName: null }));
app.post('/register', async (req, res) => { const h = await bcrypt.hash(req.body.password, 10); await pool.query("INSERT INTO users (nom, email, password, role, forfait) VALUES ($1, $2, $3, $4, 'Freemium')", [req.body.nom, req.body.email, h, req.body.role]); res.redirect('/login?msg=created'); });
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/profil', async (req, res) => { if(!req.session.userId) return res.redirect('/login'); const u = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]); res.render('profil', {user:u.rows[0], userName:req.session.userName, userRole: req.session.userRole, message: req.query.msg || null}); });
app.post('/profil/update', async (req, res) => { await pool.query("UPDATE users SET nom=$1, email=$2, telephone=$3, adresse=$4 WHERE id=$5", [req.body.nom, req.body.email, req.body.telephone, req.body.adresse, req.session.userId]); if(req.body.new_password) { const h = await bcrypt.hash(req.body.new_password, 10); await pool.query("UPDATE users SET password=$1 WHERE id=$2", [h, req.session.userId]); } res.redirect('/profil?msg=updated'); });
app.post('/profil/delete', async (req, res) => { if(!req.session.userId) return res.redirect('/login'); await pool.query("DELETE FROM users WHERE id=$1", [req.session.userId]); req.session.destroy(); res.redirect('/?msg=deleted'); });

// ADMIN
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const m = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id=u.id ORDER BY m.id DESC");
    const u = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const p = await pool.query("SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id=u.id WHERE m.statut_paiement='paye' ORDER BY m.date_paiement DESC");
    const f = await pool.query("SELECT u.nom as employe, m.titre, s.meilleur_score, s.statut FROM formations_scores s JOIN users u ON s.user_id=u.id JOIN formations_modules m ON s.module_id=m.id ORDER BY s.updated_at DESC LIMIT 20");
    let brut = 0; p.rows.forEach(x => brut += parseFloat(x.recompense)||0);
    const ap = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut='approuve' AND statut_paiement='non_paye'");
    res.render('admin-dashboard', { missions: m.rows, users: u.rows, paiements: p.rows, formations: f.rows, finance: {brut: brut.toFixed(2), tps: (brut*0.05).toFixed(2), tvq: (brut*0.09975).toFixed(2), total: (brut*1.14975).toFixed(2)}, totalAPayer: ap.rows[0].total||0, userName: req.session.userName });
});
app.get('/admin/rapport-comptable', async (req, res) => { const d = new PDFDocument(); res.setHeader('Content-Type','application/pdf'); d.pipe(res); d.text('COMPTABILITE'); d.end(); });
app.post('/admin/payer-ambassadeur', async (req, res) => { await pool.query("UPDATE missions SET statut_paiement='paye' WHERE id=$1", [req.body.id_mission]); res.redirect('/admin/dashboard'); });
app.post('/admin/approuver-mission', async (req, res) => { await pool.query("UPDATE missions SET statut='approuve' WHERE id=$1", [req.body.id_mission]); res.redirect('/admin/dashboard'); });
app.post('/admin/create-user', async (req, res) => { const h = await bcrypt.hash(req.body.password, 10); await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1,$2,$3,$4)", [req.body.nom, req.body.email, h, req.body.role]); res.redirect('/admin/dashboard'); });
app.post('/admin/delete-user', async (req, res) => { await pool.query("DELETE FROM users WHERE id=$1", [req.body.user_id]); res.redirect('/admin/dashboard'); });
app.get('/admin/rapport/:missionId', async (req, res) => { const d = await pool.query(`SELECT r.*, m.titre, m.type_audit FROM audit_reports r JOIN missions m ON r.mission_id=m.id WHERE m.id=$1`, [req.params.missionId]); res.render('admin-rapport-detail', { rapport: d.rows[0], details: d.rows[0].details, userName: req.session.userName }); });

// ENTREPRISE - MIDDLEWARE DE VERIFICATION DE LIMITE
const checkLimit = async (req, res, next) => {
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    if (user.rows[0].forfait !== 'Freemium') return next();
    const count = await pool.query("SELECT COUNT(*) FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    if (parseInt(count.rows[0].count) >= 1) return res.redirect('/entreprise/dashboard?error=limit_atteinte');
    next();
};

app.get('/entreprise/dashboard', async (req, res) => {
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom as employe_nom, m.titre as module_titre, s.meilleur_score, s.statut, s.updated_at FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1 ORDER BY s.updated_at DESC`, [req.session.userId]);
    const sondages = await pool.query("SELECT * FROM sondages_publics WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    const protocol = 'https'; const host = req.get('host'); const surveyBaseLink = `${protocol}://${host}/sondage-client/${user.rows[0].id}`;
    res.render('entreprise-dashboard', { user: user.rows[0], missions: missions.rows, scores: scores.rows, sondages: sondages.rows, userName: req.session.userName, error: req.query.error, msg: req.query.msg, surveyBaseLink: surveyBaseLink });
});

app.post('/entreprise/creer-audit', checkLimit, async (req, res) => { await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, adresse, date_expiration) VALUES ($1, $2, $3, 'Visite', $4, 'en_attente', $5, CURRENT_TIMESTAMP + INTERVAL '30 days')", [req.session.userId, req.body.titre, req.body.type_audit, req.body.recompense, req.body.adresse]); res.redirect('/entreprise/dashboard'); });
app.post('/entreprise/commander-sondage', checkLimit, async (req, res) => { await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, client_nom, client_email, date_expiration) VALUES ($1, $2, $3, 'Sondage', $4, 'en_attente', $5, $6, CURRENT_TIMESTAMP + INTERVAL '30 days')", [req.session.userId, "Sondage "+req.body.client_nom, req.body.type_sondage, req.body.recompense, req.body.client_nom, req.body.client_email]); res.redirect('/entreprise/dashboard'); });
app.post('/entreprise/ajouter-employe', async (req, res) => { const h = await bcrypt.hash(req.body.password, 10); await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", [req.body.nom, req.body.email, h, req.session.userId]); res.redirect('/entreprise/dashboard'); });
app.post('/entreprise/upload-logo', upload.single('logo'), async (req, res) => { if(req.file) { const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`; await pool.query("UPDATE users SET logo_data = $1 WHERE id = $2", [b64, req.session.userId]); } res.redirect('/entreprise/dashboard'); });
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => { const r = await pool.query(`SELECT r.details, m.titre, m.type_audit, m.created_at FROM audit_reports r JOIN missions m ON r.mission_id=m.id WHERE m.id=$1`, [req.params.id]); if(r.rows.length===0) return res.send("Non trouvé"); const d = r.rows[0]; const doc = new PDFDocument({ margin: 50 }); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition', `attachment; filename=Rapport-${req.params.id}.pdf`); doc.pipe(res); const lp = path.join(__dirname, 'images', 'logo-forfeo.png'); if(fs.existsSync(lp)) doc.image(lp, 50, 40, { width: 60 }); doc.moveDown(1).font('Helvetica-Bold').fontSize(22).fillColor('#0061ff').text('RAPPORT D\'AUDIT', {align:'center'}).font('Helvetica').fontSize(10).fillColor('#333').text('Forfeo Lab', {align:'center'}); doc.moveDown(2).fillColor('#000').fontSize(12).text(`Mission: ${d.titre}`).text(`Type: ${d.type_audit}`).text(`Date: ${new Date(d.created_at).toLocaleDateString()}`).moveDown(1.5); const y = doc.y; doc.rect(50, y, 500, 75).fillAndStroke('#f0f9ff', '#0061ff'); doc.fillColor('#0061ff').fontSize(9).text("CERTIFICATION D'INDÉPENDANCE :\nCe rapport a été complété avec objectivité et impartialité par un Ambassadeur Certifié Forfeo LAB.", 60, y+15, {width:480, align:'center'}); doc.y = y+105; doc.fillColor('#000').fontSize(14).text('Détails :', {underline:true}).moveDown(); doc.fontSize(11); for(const [k,v] of Object.entries(d.details)) { if(k!=='mission_id' && k!=='ambassadeur_id' && k!=='media_files') doc.font('Helvetica-Bold').text(`${k.toUpperCase().replace(/_/g,' ')}: `, {continued:true}).font('Helvetica').text(`${v}`).moveDown(0.5); } doc.end(); });
app.post('/entreprise/envoyer-campagne', async (req, res) => { const list = req.body.emails.split(/[\n,;]+/).map(e => e.trim()).filter(e => e); const type = req.body.type_activite; const protocol = 'https'; const host = req.get('host'); const fullLink = `${protocol}://${host}/sondage-client/${req.session.userId}?type=${encodeURIComponent(type)}`; try { if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error("Config email manquante"); for(const email of list) { await transporter.sendMail({ from: `"Forfeo Lab" <${process.env.EMAIL_USER}>`, to: email, subject: `Votre avis compte - ${req.session.userName}`, html: `<div style="font-family: Arial; padding: 20px; text-align: center; background-color: #f9f9f9;"><h2 style="color: #0061ff;">Bonjour !</h2><p>Merci de votre visite chez <strong>${req.session.userName}</strong>.</p><br><a href="${fullLink}" style="background-color: #0061ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 25px; display: inline-block;">Répondre au sondage</a></div>` }); } res.redirect('/entreprise/dashboard?msg=campagne_envoyee'); } catch (error) { console.error("ERREUR EMAIL:", error); res.redirect('/entreprise/dashboard?error=email_fail'); } });
app.get('/sondage-client/:entrepriseId', async (req, res) => { const ent = await pool.query("SELECT nom, id, logo_data FROM users WHERE id=$1", [req.params.entrepriseId]); if(ent.rows.length === 0) return res.send("Entreprise introuvable"); const type = req.query.type || 'Général'; const questions = SURVEY_TEMPLATES[type] || SURVEY_TEMPLATES['Général']; res.render('sondage-public', { entreprise: ent.rows[0], questions: questions, type: type }); });
app.post('/sondage-client/submit', async (req, res) => { await pool.query("INSERT INTO sondages_publics (entreprise_id, type_activite, reponses) VALUES ($1, $2, $3)", [req.body.entreprise_id, req.body.type_activite, JSON.stringify(req.body)]); res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1 style="color:#0061ff;">Merci !</h1><p>Votre avis a été transmis.</p><a href="/">Retour</a></div>`); });

// AMBASSADEUR & ACADEMIE
app.get('/ambassadeur/dashboard', async (req, res) => { 
    const m = await pool.query("SELECT * FROM missions WHERE statut='approuve'"); 
    const h = await pool.query("SELECT * FROM missions WHERE ambassadeur_id=$1", [req.session.userId]); 
    res.render('ambassadeur-dashboard', { missions: m.rows, historique: h.rows, totalGains: 0, userName: req.session.userName }); 
});
app.post('/ambassadeur/postuler', async (req, res) => { await pool.query("UPDATE missions SET ambassadeur_id=$1, statut='reserve' WHERE id=$2", [req.session.userId, req.body.id_mission]); res.redirect('/ambassadeur/dashboard'); });
app.post('/ambassadeur/soumettre-rapport', async (req, res) => { await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1,$2,$3)", [req.body.mission_id, req.session.userId, JSON.stringify(req.body)]); await pool.query("UPDATE missions SET statut='soumis' WHERE id=$1", [req.body.mission_id]); res.redirect('/ambassadeur/dashboard'); });
app.get('/employe/dashboard', async (req, res) => { const mod = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC"); const s = await pool.query("SELECT * FROM formations_scores WHERE user_id=$1", [req.session.userId]); res.render('employe-dashboard', { modules: mod.rows, scores: s.rows, userName: req.session.userName }); });
app.get('/formations/module/:id', async (req, res) => { const mod = await pool.query("SELECT * FROM formations_modules WHERE id=$1", [req.params.id]); const q = await pool.query("SELECT * FROM formations_questions WHERE module_id=$1 ORDER BY id ASC", [req.params.id]); res.render('formation-detail', { module: mod.rows[0], questions: q.rows, userName: req.session.userName }); });
app.post('/formations/soumettre-quizz', async (req, res) => { const qs = await pool.query("SELECT id, reponse_correcte FROM formations_questions WHERE module_id=$1", [req.body.module_id]); let score = 0; qs.rows.forEach(q => { if(req.body['q_'+q.id]===q.reponse_correcte) score++; }); const stat = (score/qs.rows.length)*100 >= 80 ? 'reussi' : 'echec'; const code = stat==='reussi' ? Math.random().toString(36).substring(7).toUpperCase() : null; await pool.query("INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) VALUES ($1,$2,$3,1,$4,$5) ON CONFLICT (user_id, module_id) DO UPDATE SET meilleur_score=GREATEST(EXCLUDED.meilleur_score, formations_scores.meilleur_score), statut=EXCLUDED.statut, code_verif=EXCLUDED.code_verif", [req.session.userId, req.body.module_id, (score/qs.rows.length)*100, stat, code]); res.redirect('/employe/dashboard'); });
app.get('/certificat/:code', async (req, res) => { const d = await pool.query("SELECT * FROM formations_scores WHERE code_verif=$1", [req.params.code]); if(d.rows.length===0) return res.send('Invalide'); const doc = new PDFDocument({layout:'landscape'}); doc.pipe(res); doc.fontSize(30).text('CERTIFICAT', {align:'center'}); doc.end(); });
app.post('/api/chat', async (req, res) => { try { const c = await openai.chat.completions.create({model:"gpt-4o-mini", messages:[{role:"system",content:knowledgeBase},{role:"user",content:req.body.message}]}); res.json({reply:c.choices[0].message.content}); } catch(e) { res.json({reply:"Erreur."}); } });

app.listen(port, () => console.log('🚀 LIVE'));

### 2. `views/entreprise-dashboard.ejs`
*Avec les liens Stripe, le logo aligné, le verrouillage des missions.*

```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Espace Pro | FORFEO</title>
    <link href="[https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css](https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css)" rel="stylesheet">
    <link rel="stylesheet" href="/css/premium-dashboard.css">
    <link rel="stylesheet" href="/css/home-premium.css">
    <link rel="stylesheet" href="[https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css](https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css)">
    <script src="[https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js](https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js)"></script>
    <style>
        .profile-logo { width: 60px; height: 60px; object-fit: cover; border-radius: 50%; border: 2px solid #0061ff; }
        .logo-placeholder { width: 60px; height: 60px; border-radius: 50%; background: #f8f9fa; display: flex; align-items: center; justify-content: center; border: 2px solid #e9ecef; color: #0061ff; font-size: 24px; }
        .locked-overlay { position: relative; opacity: 0.6; pointer-events: none; }
        .lock-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 3rem; color: #dc3545; z-index: 10; text-shadow: 0 2px 10px rgba(0,0,0,0.2); }
    </style>
</head>
<body>
    <div class="premium-bg"></div>
    <div class="container py-5">
        
        <% if (typeof error !== 'undefined' && error === 'limit_atteinte') { %>
            <div class="alert alert-warning text-center fw-bold shadow mb-4 border-warning">
                <i class="bi bi-lock-fill me-2"></i>Limite atteinte. Abonnez-vous pour débloquer plus de missions.
            </div>
        <% } %>
        <% if (typeof error !== 'undefined' && error === 'email_fail') { %>
            <div class="alert alert-danger text-center fw-bold shadow mb-4">❌ Erreur d'envoi SMTP.</div>
        <% } %>
        <% if (typeof msg !== 'undefined' && msg === 'campagne_envoyee') { %>
            <div class="alert alert-success text-center fw-bold shadow mb-4"><i class="bi bi-send-check-fill me-2"></i>Campagne envoyée !</div>
        <% } %>

        <div class="d-flex justify-content-between align-items-center mb-5 flex-wrap gap-3 bg-white p-3 rounded-4 shadow-sm">
            <div class="d-flex align-items-center gap-3">
                <% if(user.logo_data) { %>
                    <img src="<%= user.logo_data %>" class="profile-logo shadow-sm" alt="Logo">
                <% } else { %>
                    <div class="logo-placeholder"><i class="bi bi-building"></i></div>
                <% } %>
                <h3 class="fw-bold mb-0 text-dark">Bonjour, <%= userName %></h3>
            </div>

            <form action="/entreprise/upload-logo" method="POST" enctype="multipart/form-data" class="d-flex gap-2 align-items-center">
                <input type="file" name="logo" class="form-control form-control-sm rounded-pill" required style="width: 200px;">
                <button class="btn btn-dark btn-sm rounded-pill px-3">Sauvegarder</button>
            </form>

            <div class="d-flex gap-2">
                <a href="/profil" class="btn btn-outline-primary btn-sm rounded-pill px-3">Profil</a>
                <a href="/logout" class="btn btn-danger btn-sm rounded-pill px-3">Déconnexion</a>
            </div>
        </div>

        <% if(user.forfait === 'Freemium') { %>
            <div class="text-center mb-5">
                <h4 class="fw-bold mb-4">Débloquez votre potentiel 🚀</h4>
                <div class="row g-4 justify-content-center">
                    <div class="col-md-4">
                        <div class="card h-100 border-0 shadow-sm p-4 text-center hover-scale">
                            <h5 class="fw-bold text-muted">Découverte</h5>
                            <h2 class="text-dark fw-bolder my-3">49$</h2>
                            <ul class="list-unstyled small text-muted mb-4">
                                <li>1 Audit Mystère</li>
                                <li>Rapport PDF</li>
                            </ul>
                            <a href="[https://buy.stripe.com/8x228s2eSgIT9Qs65Ed7q0j](https://buy.stripe.com/8x228s2eSgIT9Qs65Ed7q0j)" target="_blank" class="btn btn-outline-dark w-100 rounded-pill fw-bold">Choisir</a>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card h-100 border-primary shadow p-4 text-center transform-scale-1">
                            <div class="badge bg-primary position-absolute top-0 start-50 translate-middle px-3 py-2 rounded-pill">Populaire</div>
                            <h5 class="fw-bold text-primary mt-2">Découverte+</h5>
                            <h2 class="text-primary fw-bolder my-3">119$</h2>
                            <ul class="list-unstyled small text-muted mb-4">
                                <li>3 Audits Mystère</li>
                                <li>Support Prioritaire</li>
                            </ul>
                            <a href="[https://buy.stripe.com/dRm7sM3iW2S36Eg9hQd7q0i](https://buy.stripe.com/dRm7sM3iW2S36Eg9hQd7q0i)" target="_blank" class="btn btn-primary w-100 rounded-pill fw-bold shadow-lg">Choisir</a>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card h-100 border-0 shadow-sm p-4 text-center hover-scale">
                            <h5 class="fw-bold text-success">Croissance</h5>
                            <h2 class="text-success fw-bolder my-3">69$<small class="fs-6 text-muted">/mois</small></h2>
                            <ul class="list-unstyled small text-muted mb-4">
                                <li>Audits Illimités</li>
                                <li>Tableau de bord complet</li>
                            </ul>
                            <a href="[https://buy.stripe.com/6oU00k9HkdwH1jW2Tsd7q0h](https://buy.stripe.com/6oU00k9HkdwH1jW2Tsd7q0h)" target="_blank" class="btn btn-outline-success w-100 rounded-pill fw-bold">S'abonner</a>
                        </div>
                    </div>
                </div>
            </div>
        <% } %>

        <ul class="nav nav-pills mb-4 gap-3 p-2 glass-card d-inline-flex flex-wrap" id="dashboardTabs" role="tablist">
            <li class="nav-item"><button class="nav-link active rounded-pill fw-bold" id="missions-tab" data-bs-toggle="tab" data-bs-target="#missions">Audits & Missions</button></li>
            <li class="nav-item"><button class="nav-link rounded-pill fw-bold" id="campagnes-tab" data-bs-toggle="tab" data-bs-target="#campagnes">Campagnes & Sondages</button></li>
            <li class="nav-item"><button class="nav-link rounded-pill fw-bold" id="academie-tab" data-bs-toggle="tab" data-bs-target="#academie">Suivi Académie</button></li>
            <li class="nav-item"><button class="nav-link rounded-pill fw-bold" id="employes-tab" data-bs-toggle="tab" data-bs-target="#employes">Gestion Employés</button></li>
        </ul>

        <div class="tab-content">
            
            <div class="tab-pane fade show active" id="missions">
                <div class="row g-4">
                    <div class="col-lg-4">
                        <% 
                            const isLocked = user.forfait === 'Freemium' && missions.length >= 1; 
                        %>
                        
                        <div class="glass-card mb-4 position-relative <%= isLocked ? 'locked-overlay' : '' %>">
                            <% if(isLocked) { %>
                                <div class="lock-icon"><i class="bi bi-lock-fill"></i></div>
                            <% } %>
                            
                            <h5 class="fw-bold">Publier Audit Terrain</h5>
                            <form action="/entreprise/creer-audit" method="POST">
                                <input type="text" name="titre" placeholder="Lieu" class="form-control mb-2" required <%= isLocked ? 'disabled' : '' %>>
                                <input type="text" name="adresse" placeholder="Adresse" class="form-control mb-2" required <%= isLocked ? 'disabled' : '' %>>
                                <select name="type_audit" class="form-select mb-2" <%= isLocked ? 'disabled' : '' %>><option>Audit Standard</option><option>Audit Qualité</option></select>
                                <input type="text" name="recompense" placeholder="Récompense ($)" class="form-control mb-2" required <%= isLocked ? 'disabled' : '' %>>
                                
                                <% if(isLocked) { %>
                                    <button type="button" class="btn btn-secondary w-100" disabled>Limite atteinte</button>
                                <% } else { %>
                                    <button class="btn btn-primary w-100">Publier</button>
                                <% } %>
                            </form>
                        </div>

                        <div class="glass-card border-info position-relative <%= isLocked ? 'locked-overlay' : '' %>">
                            <h5 class="fw-bold text-info">Commander Sondage</h5>
                            <form action="/entreprise/commander-sondage" method="POST">
                                <input type="text" name="client_nom" placeholder="Nom Client" class="form-control mb-2" <%= isLocked ? 'disabled' : '' %>>
                                <input type="email" name="client_email" placeholder="Email Client" class="form-control mb-2" <%= isLocked ? 'disabled' : '' %>>
                                <select name="type_sondage" class="form-select mb-2" <%= isLocked ? 'disabled' : '' %>><option>Satisfaction</option></select>
                                <input type="text" name="recompense" placeholder="Récompense ($)" class="form-control mb-2" <%= isLocked ? 'disabled' : '' %>>
                                <button class="btn btn-info text-white w-100" <%= isLocked ? 'disabled' : '' %>>Commander</button>
                            </form>
                        </div>
                    </div>

                    <div class="col-lg-8">
                        <div class="glass-card">
                            <h5 class="fw-bold">Historique</h5>
                            <table class="premium-table">
                                <% missions.forEach(m => { %>
                                    <tr>
                                        <td><%= m.titre %></td>
                                        <td><span class="badge bg-secondary"><%= m.statut %></span></td>
                                        <td><% if(m.statut === 'approuve'){ %><a href="/entreprise/telecharger-rapport/<%= m.id %>" class="btn btn-sm btn-outline-success">PDF</a><% } %></td>
                                    </tr>
                                <% }) %>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <div class="tab-pane fade" id="campagnes">
                <div class="row g-4">
                    <div class="col-lg-5">
                        <div class="glass-card h-100 border-primary border-2 shadow-lg text-center">
                            <h4 class="fw-bold mb-3 text-primary">QR Code Intelligent</h4>
                            <div class="bg-white p-4 rounded-4 border d-inline-block mb-3">
                                <img id="dynamic-qr" src="[https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=](https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=)<%= encodeURIComponent(surveyBaseLink + '?type=Général') %>" class="img-fluid">
                            </div>
                            <div class="input-group">
                                <input type="text" id="dynamic-link" class="form-control form-control-sm bg-light" value="<%= surveyBaseLink %>?type=Général" readonly>
                                <button class="btn btn-outline-secondary btn-sm" onclick="copyLink()"><i class="bi bi-clipboard"></i></button>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-7">
                        <div class="glass-card mb-4">
                            <h5 class="fw-bold mb-3">Lancer une campagne</h5>
                            <form action="/entreprise/envoyer-campagne" method="POST">
                                <div class="mb-3">
                                    <select class="form-select" name="type_activite" id="survey-type-selector">
                                        <option value="Général">Général</option><option value="Restaurant">Restaurant</option><option value="Hôtel">Hôtel</option><option value="Magasin">Magasin</option>
                                    </select>
                                </div>
                                <div class="mb-3"><textarea name="emails" class="form-control" rows="3" placeholder="Emails..." required></textarea></div>
                                <button class="btn btn-success w-100 rounded-pill">Envoyer</button>
                            </form>
                        </div>
                        <div class="glass-card">
                            <h5 class="fw-bold mb-3">Réponses</h5>
                            <div class="list-group list-group-flush" style="max-height: 300px; overflow-y: auto;">
                                <% if(sondages && sondages.length > 0) { %>
                                    <% sondages.forEach(s => { 
                                        const rep = s.reponses;
                                        let starSum = 0, starCount = 0, comment = "";
                                        for(let key in rep) {
                                            if(!['entreprise_id', 'entreprise_nom', 'type_activite'].includes(key)) {
                                                const val = rep[key];
                                                if(!isNaN(val) && val >= 1 && val <= 5) { starSum += parseInt(val); starCount++; }
                                                else if(typeof val === 'string' && val.length > 3) { comment = val; }
                                            }
                                        }
                                        let avg = starCount > 0 ? (starSum / starCount).toFixed(1) : null;
                                    %>
                                        <div class="list-group-item bg-transparent border-bottom py-3">
                                            <div class="d-flex justify-content-between mb-1">
                                                <span class="badge bg-light text-dark border"><%= s.type_activite %></span>
                                                <small class="text-muted"><%= new Date(s.created_at).toLocaleDateString() %></small>
                                            </div>
                                            <% if(avg) { %><div class="text-warning h5 fw-bold"><%= avg %> ★</div><% } %>
                                            <% if(comment) { %><div class="small text-muted fst-italic">"<%= comment %>"</div><% } %>
                                        </div>
                                    <% }) %>
                                <% } else { %>
                                    <p class="text-muted small text-center">Aucune réponse.</p>
                                <% } %>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="tab-pane fade" id="academie">
                <div class="glass-card"><h5 class="fw-bold">Performance</h5><table class="premium-table"><% scores.forEach(s => { %><tr><td><%= s.employe_nom %></td><td><%= s.module_titre %></td><td><%= s.statut %></td></tr><% }) %></table></div>
            </div>

            <div class="tab-pane fade" id="employes">
                <div class="glass-card"><h5 class="fw-bold">Ajout Employé</h5><form action="/entreprise/ajouter-employe" method="POST"><input type="text" name="nom" class="form-control mb-2" placeholder="Nom"><input type="email" name="email" class="form-control mb-2" placeholder="Email"><input type="password" name="password" class="form-control mb-2" placeholder="Pass"><button class="btn btn-success w-100">Créer</button></form></div>
            </div>
        </div>
    </div>
    <%- include('partials/forfy') %>
    <script>
        function copyLink() {
            const el = document.getElementById("dynamic-link"); el.select(); navigator.clipboard.writeText(el.value); alert("Copié !");
        }
        const base = "<%= typeof surveyBaseLink !== 'undefined' ? surveyBaseLink : '' %>";
        const sel = document.getElementById('survey-type-selector');
        const img = document.getElementById('dynamic-qr');
        const inp = document.getElementById('dynamic-link');
        if(sel && img) {
            sel.addEventListener('change', function() {
                const url = base + "?type=" + encodeURIComponent(this.value);
                img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
                inp.value = url;
            });
        }
    </script>
</body>
</html>
