const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- DONNÉES ACADÉMIE ---
const ACADEMY_DATA = [
    {
        id: 1, titre: "Excellence du Service Client", description: "Créer un effet WOW.", icon: "bi-emoji-smile", duree: "20 min",
        questions: [{ q: "Un client entre pendant un appel.", a: "Ignorer", b: "Signe de tête", c: "Raccrocher", rep: "B", sit: "Multitâche" }, { q: "Règle 10-4", a: "10 pieds sourire, 4 pieds salut", b: "Distance sécurité", c: "Temps service", rep: "A", sit: "Proactivité" }, { q: "Client régulier", a: "Bonjour", b: "Bonjour M. X", c: "Suivant", rep: "B", sit: "Personnalisation" }, { q: "Incapable de répondre", a: "Je sais pas", b: "Pas mon rayon", c: "Je vérifie", rep: "C", sit: "Proactivité" }, { q: "Fin interaction", a: "Facture", b: "Remerciement", c: "Dos tourné", rep: "B", sit: "Départ" }]
    },
    { id: 2, titre: "Communication", description: "Écoute active.", icon: "bi-ear", duree: "25 min", questions: [{q:"Ecoute active", a:"Préparer réponse", b:"Comprendre", c:"Hocher", rep:"B"}, {q:"Non verbal", a:"7%", b:"55%", c:"0%", rep:"B"}, {q:"Client pressé", a:"Parler lent", b:"Matching", c:"Calmer", rep:"B"}, {q:"Empathie", a:"Calmez vous", b:"Pas ma faute", c:"Je comprends", rep:"C"}, {q:"Reformuler", a:"Gagner temps", b:"Valider", c:"Intelligence", rep:"B"}] },
    { id: 3, titre: "Situations Difficiles", description: "Gérer les plaintes.", icon: "bi-shield-exclamation", duree: "30 min", questions: [{q:"LATTE", a:"Listen Acknowledge...", b:"Late...", c:"Leave...", rep:"A"}, {q:"Client crie", a:"Crier", b:"Calme", c:"Ignorer", rep:"B"}, {q:"Remboursement refusé", a:"Non", b:"Politique", c:"Alternative", rep:"C"}, {q:"Insulte", a:"Insulter", b:"Fixer limite", c:"Pleurer", rep:"B"}, {q:"Après conflit", a:"Rire", b:"Oublier", c:"Récupération", rep:"C"}] },
    { id: 4, titre: "Culture Qualité", description: "Détails et standards.", icon: "bi-gem", duree: "20 min", questions: [{q:"Papier par terre", a:"Pas grave", b:"Image marque", c:"Chef regarde", rep:"B"}, {q:"Feedback", a:"Attaque", b:"Cadeau", c:"Perte temps", rep:"B"}, {q:"Constance", a:"1 fois sur 2", b:"Chaque jour", c:"Moyen", rep:"B"}, {q:"Erreur collègue", a:"Chicaner", b:"Corriger discret", c:"Rire", rep:"B"}, {q:"Responsable qualité", a:"Patron", b:"Gérant", c:"Tout le monde", rep:"C"}] },
    { id: 5, titre: "Professionnalisme", description: "Image et équipe.", icon: "bi-people", duree: "20 min", questions: [{q:"Ponctualité", a:"Option", b:"Respect", c:"Pas grave", rep:"B"}, {q:"Uniforme", a:"Non", b:"Reflet marque", c:"Joli", rep:"B"}, {q:"Rush", a:"Tant pis", b:"Aider", c:"Pause", rep:"B"}, {q:"Cellulaire", a:"Ok", b:"Aider", c:"A éviter", rep:"C"}, {q:"Parler en mal", a:"Normal", b:"Déloyal", c:"Drôle", rep:"B"}] }
];

// --- QUESTIONS SONDAGES PAR TYPE (AUTOMATISÉS) ---
const SURVEY_TEMPLATES = {
    "Restaurant": [
        { id: "q1", text: "Comment avez-vous trouvé l'accueil à votre arrivée ?", type: "stars" },
        { id: "q2", text: "La qualité des plats était-elle à la hauteur de vos attentes ?", type: "stars" },
        { id: "q3", text: "Le service était-il rapide et courtois ?", type: "yesno" },
        { id: "q4", text: "Recommanderiez-vous notre restaurant à un ami ?", type: "scale" }
    ],
    "Hôtel": [
        { id: "q1", text: "La propreté de la chambre était-elle irréprochable ?", type: "stars" },
        { id: "q2", text: "Comment évaluez-vous le confort de la literie ?", type: "stars" },
        { id: "q3", text: "Le personnel de réception a-t-il été utile ?", type: "yesno" },
        { id: "q4", text: "Avez-vous rencontré des problèmes de bruit ?", type: "text" }
    ],
    "Magasin": [
        { id: "q1", text: "Avez-vous trouvé facilement ce que vous cherchiez ?", type: "yesno" },
        { id: "q2", text: "Les conseils du vendeur étaient-ils pertinents ?", type: "stars" },
        { id: "q3", text: "Êtes-vous satisfait du rapport qualité/prix ?", type: "stars" }
    ],
    "Autre": [
        { id: "q1", text: "Quelle est votre satisfaction globale ?", type: "stars" },
        { id: "q2", text: "Qu'est-ce que nous pourrions améliorer ?", type: "text" }
    ]
};

const knowledgeBase = `Tu es Forfy, IA de Forfeo Lab. Tu aides sur les audits, sondages et l'académie.`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v34_automated_surveys',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- BDD ---
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium', telephone VARCHAR(50), adresse TEXT);
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS sondages_publics (id SERIAL PRIMARY KEY, entreprise_id INTEGER, type_activite VARCHAR(50), reponses JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // Rechargement Académie
        const countQ = await pool.query("SELECT COUNT(*) FROM formations_questions");
        await pool.query("TRUNCATE formations_questions RESTART IDENTITY CASCADE");
        await pool.query("TRUNCATE formations_modules RESTART IDENTITY CASCADE");
        for (const mod of ACADEMY_DATA) {
            await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5)`, [mod.id, mod.titre, mod.description, mod.icon, mod.duree]);
            for (const q of mod.questions) {
                await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation, explication) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [mod.id, q.q, q.a, q.b, q.c, q.rep, q.sit, "Explication standard"]);
            }
        }
        console.log("✅ DB prête.");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// --- ROUTES ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/a-propos', (req, res) => res.render('a-propos', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

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
app.post('/register', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role, forfait) VALUES ($1, $2, $3, $4, 'Freemium')", [req.body.nom, req.body.email, hash, req.body.role]);
    res.redirect('/login?msg=created');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/profil', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]); res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null }); });
app.post('/profil/update', async (req, res) => { await pool.query("UPDATE users SET nom=$1, email=$2, telephone=$3, adresse=$4 WHERE id=$5", [req.body.nom, req.body.email, req.body.telephone, req.body.adresse, req.session.userId]); if(req.body.new_password) { const hash = await bcrypt.hash(req.body.new_password, 10); await pool.query("UPDATE users SET password=$1 WHERE id=$2", [hash, req.session.userId]); } res.redirect('/profil?msg=updated'); });
app.post('/profil/delete', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); await pool.query("DELETE FROM users WHERE id=$1", [req.session.userId]); req.session.destroy(); res.redirect('/?msg=deleted'); });

// ADMIN
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye' ORDER BY m.date_paiement DESC`);
    const formations = await pool.query(`SELECT u.nom as employe, m.titre, s.meilleur_score, s.statut FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id ORDER BY s.updated_at DESC LIMIT 20`);
    let brut = 0; paiements.rows.forEach(p => brut += (parseFloat(p.recompense) || 0));
    const aPayer = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut = 'approuve' AND statut_paiement = 'non_paye'");
    res.render('admin-dashboard', { missions: missions.rows, users: users.rows, paiements: paiements.rows, formations: formations.rows, finance: { brut: brut.toFixed(2), tps: (brut*0.05).toFixed(2), tvq: (brut*0.09975).toFixed(2), total: (brut*1.14975).toFixed(2) }, totalAPayer: aPayer.rows[0].total || 0, userName: req.session.userName });
});
// (Routes Admin PDF, Payer, Approuver, Create/Delete User, Rapport inchangées - voir code précédent si besoin, mais je garde court pour focus sur Sondages)
app.get('/admin/rapport-comptable', async (req, res) => { const doc = new PDFDocument(); res.setHeader('Content-Type', 'application/pdf'); doc.pipe(res); doc.text('COMPTABILITÉ'); doc.end(); });
app.post('/admin/payer-ambassadeur', async (req, res) => { await pool.query("UPDATE missions SET statut_paiement='paye' WHERE id=$1", [req.body.id_mission]); res.redirect('/admin/dashboard'); });
app.post('/admin/approuver-mission', async (req, res) => { await pool.query("UPDATE missions SET statut='approuve' WHERE id=$1", [req.body.id_mission]); res.redirect('/admin/dashboard'); });
app.post('/admin/create-user', async (req, res) => { const hash = await bcrypt.hash(req.body.password, 10); await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1,$2,$3,$4)", [req.body.nom, req.body.email, hash, req.body.role]); res.redirect('/admin/dashboard'); });
app.post('/admin/delete-user', async (req, res) => { await pool.query("DELETE FROM users WHERE id=$1", [req.body.user_id]); res.redirect('/admin/dashboard'); });
app.get('/admin/rapport/:missionId', async (req, res) => { const data = await pool.query(`SELECT r.*, m.titre, m.type_audit FROM audit_reports r JOIN missions m ON r.mission_id=m.id WHERE m.id=$1`, [req.params.missionId]); res.render('admin-rapport-detail', { rapport: data.rows[0], details: data.rows[0].details, userName: req.session.userName }); });

// --- ENTREPRISE (AVEC SONDAGES AUTOMATISÉS) ---
app.get('/entreprise/dashboard', async (req, res) => {
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom as employe_nom, m.titre as module_titre, s.meilleur_score, s.statut, s.updated_at FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1 ORDER BY s.updated_at DESC`, [req.session.userId]);
    
    // Récupérer les résultats des sondages publics
    const sondages = await pool.query("SELECT * FROM sondages_publics WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);

    res.render('entreprise-dashboard', { 
        user: user.rows[0], missions: missions.rows, scores: scores.rows, sondages: sondages.rows,
        userName: req.session.userName, error: req.query.error, survey_link: `https://${req.get('host')}/sondage-client/${user.rows[0].id}`
    });
});
app.post('/entreprise/creer-audit', async (req, res) => { await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, adresse) VALUES ($1, $2, $3, 'Visite', $4, 'en_attente', $5)", [req.session.userId, req.body.titre, req.body.type_audit, req.body.recompense, req.body.adresse]); res.redirect('/entreprise/dashboard'); });
app.post('/entreprise/commander-sondage', async (req, res) => { await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, client_nom, client_email) VALUES ($1, $2, $3, 'Sondage', $4, 'en_attente', $5, $6)", [req.session.userId, "Sondage "+req.body.client_nom, req.body.type_sondage, req.body.recompense, req.body.client_nom, req.body.client_email]); res.redirect('/entreprise/dashboard'); });
app.post('/entreprise/ajouter-employe', async (req, res) => { const hash = await bcrypt.hash(req.body.password, 10); await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", [req.body.nom, req.body.email, hash, req.session.userId]); res.redirect('/entreprise/dashboard'); });

// --- NOUVEAU : RAPPORT PDF CORRIGÉ (ALIGNEMENT) ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => { 
    const report = await pool.query(`SELECT r.details, m.titre, m.type_audit, m.created_at FROM audit_reports r JOIN missions m ON r.mission_id = m.id WHERE m.id = $1`, [req.params.id]);
    if(report.rows.length === 0) return res.send("Non trouvé");

    const data = report.rows[0];
    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf'); 
    res.setHeader('Content-Disposition', `attachment; filename=Rapport-Forfeo-${req.params.id}.pdf`);
    doc.pipe(res); 

    // Logo
    const logoPath = path.join(__dirname, 'images', 'logo-forfeo.png');
    if(fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 60 });

    // En-tête
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0061ff').text('RAPPORT D\'AUDIT', {align:'center'});
    doc.font('Helvetica').fontSize(10).fillColor('#333').text('Forfeo Lab - Division de FORFEO INC.', {align:'center'});
    
    doc.moveDown(2);
    doc.fillColor('#000').fontSize(12);
    doc.text(`Mission : ${data.titre}`);
    doc.text(`Type : ${data.type_audit}`);
    doc.text(`Date : ${new Date(data.created_at).toLocaleDateString()}`);
    
    doc.moveDown(1.5); 

    // --- ENCADRÉ OBJECTIVITÉ CORRIGÉ ---
    const startY = doc.y;
    const boxHeight = 75; 

    doc.rect(50, startY, 500, boxHeight).fillAndStroke('#f0f9ff', '#0061ff');
    doc.fillColor('#0061ff').fontSize(9).text(
        "CERTIFICATION D'INDÉPENDANCE :\nCe rapport a été complété avec objectivité et impartialité par un Ambassadeur Certifié Forfeo LAB. Les observations consignées reflètent fidèlement l'expérience client vécue, conformément aux standards de qualité de Forfeo Inc.",
        60, startY + 15, { width: 480, align: 'center' }
    );

    doc.y = startY + boxHeight + 30; // Force descente du curseur
    
    // Détails
    doc.fillColor('#000').fontSize(14).text('Détails de l\'évaluation :', { underline: true });
    doc.moveDown(1);
    doc.fontSize(11);
    
    const details = data.details;
    for (const [key, value] of Object.entries(details)) {
        if(key !== 'mission_id' && key !== 'ambassadeur_id' && key !== 'media_files') {
            doc.font('Helvetica-Bold').text(`${key.toUpperCase().replace(/_/g, ' ')} : `, { continued: true });
            doc.font('Helvetica').text(`${value}`);
            doc.moveDown(0.5);
        }
    }

    doc.moveDown(4);
    doc.fontSize(8).fillColor('#999').text('© 2025 Forfeo Inc. Document confidentiel.', {align:'center'});
    doc.end(); 
});

// NOUVEAU : ENVOI DE CAMPAGNE EMAIL
app.post('/entreprise/envoyer-campagne', async (req, res) => {
    // Dans une vraie app, on utiliserait Nodemailer ici.
    console.log("Envoi de campagne à : ", req.body.emails);
    res.redirect('/entreprise/dashboard?msg=campagne_envoyee');
});

// NOUVEAU : SONDAGE PUBLIC (CÔTÉ CLIENT)
app.get('/sondage-client/:entrepriseId', async (req, res) => {
    const ent = await pool.query("SELECT nom, id FROM users WHERE id = $1", [req.params.entrepriseId]);
    if(ent.rows.length === 0) return res.send("Entreprise introuvable");
    
    // Déterminer le type de questions
    const type = req.query.type || 'Restaurant'; 
    const questions = SURVEY_TEMPLATES[type] || SURVEY_TEMPLATES['Autre'];

    res.render('sondage-public', { entreprise: ent.rows[0], questions: questions, type: type });
});

app.post('/sondage-client/submit', async (req, res) => {
    await pool.query("INSERT INTO sondages_publics (entreprise_id, type_activite, reponses) VALUES ($1, $2, $3)", 
        [req.body.entreprise_id, req.body.type_activite, JSON.stringify(req.body)]);
    res.send(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
            <h1 style="color:#0061ff;">Merci !</h1>
            <p>Votre avis a été transmis à l'équipe de ${req.body.entreprise_nom}.</p>
            <a href="/" style="color:#666;">Retour à Forfeo</a>
        </div>
    `);
});

// AMBASSADEUR & ACADEMIE (Codes inchangés)
app.get('/ambassadeur/dashboard', async (req, res) => { const m = await pool.query("SELECT * FROM missions WHERE statut='approuve'"); const h = await pool.query("SELECT * FROM missions WHERE ambassadeur_id=$1", [req.session.userId]); res.render('ambassadeur-dashboard', { missions: m.rows, historique: h.rows, totalGains: 0, userName: req.session.userName }); });
app.post('/ambassadeur/postuler', async (req, res) => { await pool.query("UPDATE missions SET ambassadeur_id=$1, statut='reserve' WHERE id=$2", [req.session.userId, req.body.id_mission]); res.redirect('/ambassadeur/dashboard'); });
app.post('/ambassadeur/soumettre-rapport', async (req, res) => { await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1,$2,$3)", [req.body.mission_id, req.session.userId, JSON.stringify(req.body)]); await pool.query("UPDATE missions SET statut='soumis' WHERE id=$1", [req.body.mission_id]); res.redirect('/ambassadeur/dashboard'); });
app.get('/employe/dashboard', async (req, res) => { const mod = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC"); const s = await pool.query("SELECT * FROM formations_scores WHERE user_id=$1", [req.session.userId]); res.render('employe-dashboard', { modules: mod.rows, scores: s.rows, userName: req.session.userName }); });
app.get('/formations/module/:id', async (req, res) => { const mod = await pool.query("SELECT * FROM formations_modules WHERE id=$1", [req.params.id]); const q = await pool.query("SELECT * FROM formations_questions WHERE module_id=$1 ORDER BY id ASC", [req.params.id]); res.render('formation-detail', { module: mod.rows[0], questions: q.rows, userName: req.session.userName }); });
app.post('/formations/soumettre-quizz', async (req, res) => {
    const qs = await pool.query("SELECT id, reponse_correcte FROM formations_questions WHERE module_id=$1", [req.body.module_id]);
    let score = 0; qs.rows.forEach(q => { if(req.body['q_'+q.id]===q.reponse_correcte) score++; });
    const stat = (score/qs.rows.length)*100 >= 80 ? 'reussi' : 'echec';
    const code = stat==='reussi' ? Math.random().toString(36).substring(7).toUpperCase() : null;
    await pool.query("INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) VALUES ($1,$2,$3,1,$4,$5) ON CONFLICT (user_id, module_id) DO UPDATE SET meilleur_score=GREATEST(EXCLUDED.meilleur_score, formations_scores.meilleur_score), statut=EXCLUDED.statut, code_verif=EXCLUDED.code_verif", [req.session.userId, req.body.module_id, (score/qs.rows.length)*100, stat, code]);
    res.redirect('/employe/dashboard');
});
app.get('/certificat/:code', async (req, res) => { const d = await pool.query("SELECT * FROM formations_scores WHERE code_verif=$1", [req.params.code]); if(d.rows.length===0) return res.send('Invalide'); const doc = new PDFDocument({layout:'landscape'}); doc.pipe(res); doc.fontSize(30).text('CERTIFICAT', {align:'center'}); doc.end(); });
app.post('/api/chat', async (req, res) => { try { const c = await openai.chat.completions.create({model:"gpt-4o-mini", messages:[{role:"system",content:knowledgeBase},{role:"user",content:req.body.message}]}); res.json({reply:c.choices[0].message.content}); } catch(e) { res.json({reply:"Erreur."}); } });

app.listen(port, () => console.log('🚀 LIVE'));
