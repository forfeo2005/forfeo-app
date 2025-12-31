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

// --- BANQUE DE FORMATION (VRAI CONTENU) ---
const COURSES_DATA = [
    {
        id: 1, titre: "Excellence du Service Client", description: "Comprendre les bases pour créer un effet WOW et fidéliser.", icon: "bi-emoji-smile", duree: "20 min",
        questions: [
            { q: "Un client entre alors que vous êtes au téléphone. Quelle est la meilleure réaction ?", a: "L'ignorer jusqu'à la fin de l'appel.", b: "Lui faire un signe de tête et sourire pour valider sa présence.", c: "Raccrocher au nez de votre interlocuteur.", rep: "B", sit: "Situation : Vous êtes occupé au téléphone." },
            { q: "La règle du 10-4 (10 pieds, 4 pieds) signifie :", a: "À 10 pieds je souris, à 4 pieds je salue verbalement.", b: "Je reste à 10 pieds du client.", c: "Je dois servir le client en 4 minutes.", rep: "A", sit: "Concept : Proactivité et accueil." },
            { q: "Un client régulier arrive. Vous connaissez son nom.", a: "Bonjour Monsieur !", b: "Bonjour M. Tremblay ! Ravi de vous revoir.", c: "Suivant !", rep: "B", sit: "Concept : Personnalisation." },
            { q: "Le client vous pose une question dont vous ignorez la réponse.", a: "Je ne sais pas.", b: "Ce n'est pas mon département.", c: "Excellente question, je vérifie pour vous immédiatement.", rep: "C", sit: "Situation : Demande technique." },
            { q: "Quelle est la dernière étape d'une interaction client réussie ?", a: "Donner la facture.", b: "Le remerciement et l'invitation à revenir.", c: "Tourner le dos pour ranger.", rep: "B", sit: "Concept : La conclusion (Last impression)." }
        ]
    },
    {
        id: 2, titre: "Communication & Écoute Active", description: "Le ton, l'empathie et la reformulation.", icon: "bi-ear", duree: "25 min",
        questions: [
            { q: "L'écoute active, c'est principalement :", a: "Préparer sa réponse pendant que l'autre parle.", b: "Écouter pour comprendre, sans interrompre, et reformuler.", c: "Hocher la tête sans écouter.", rep: "B", sit: "Concept : Écoute." },
            { q: "Le langage non-verbal (corps, visage) représente quel % du message ?", a: "Environ 7%", b: "Environ 55%", c: "0%", rep: "B", sit: "Concept : Communication non-verbale." },
            { q: "Si un client parle vite et semble pressé, vous devez :", a: "Parler très lentement pour le calmer.", b: "Adapter votre rythme pour être efficace et concis.", c: "Lui dire de se calmer.", rep: "B", sit: "Technique : Le miroir (Matching)." },
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
            { q: "Après avoir résolu un conflit, il faut :", a: "En parler à tous les collègues pour rire.", b: "Oublier.", c: "S'assurer que le client part apaisé et satisfait.", rep: "C", sit: "Concept : Récupération de service." }
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

const knowledgeBase = `Tu es Forfy, IA de Forfeo Lab (Division de FORFEO INC). Tu aides Ambassadeurs, Entreprises et Admins.`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v30_academy_pro',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// INITIALISATION BDD AVEC VRAI CONTENU
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium', telephone VARCHAR(50), adresse TEXT);
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // On recharge les questions à chaque démarrage pour garantir qu'elles sont à jour
        const countQ = await pool.query("SELECT COUNT(*) FROM formations_questions");
        // Logique : On vide et on remplit pour être sûr d'avoir les vraies questions
        await pool.query("TRUNCATE formations_questions RESTART IDENTITY CASCADE");
        await pool.query("TRUNCATE formations_modules RESTART IDENTITY CASCADE");
        
        for (const mod of COURSES_DATA) {
            await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5)`, [mod.id, mod.titre, mod.description, mod.icon, mod.duree]);
            for (const q of mod.questions) {
                await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation, explication) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [mod.id, q.q, q.a, q.b, q.c, q.rep, q.sit, "Explication standard"]);
            }
        }
        console.log("✅ Académie chargée avec succès.");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// ROUTES STANDARD
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
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null });
});
app.post('/profil/update', async (req, res) => {
    await pool.query("UPDATE users SET nom = $1, email = $2, telephone = $3, adresse = $4 WHERE id = $5", [req.body.nom, req.body.email, req.body.telephone, req.body.adresse, req.session.userId]);
    if(req.body.new_password) {
        const hash = await bcrypt.hash(req.body.new_password, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    }
    res.redirect('/profil?msg=updated');
});

// ADMIN (AVEC VUE FORMATIONS)
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye' ORDER BY m.date_paiement DESC`);
    
    // NOUVEAU : Suivi des formations pour Admin
    const formations = await pool.query(`SELECT u.nom as employe, u.entreprise_id, m.titre, s.meilleur_score, s.statut FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id ORDER BY s.updated_at DESC LIMIT 20`);

    let brut = 0; paiements.rows.forEach(p => brut += (parseFloat(p.recompense) || 0));
    const tps = brut * 0.05; const tvq = brut * 0.09975;
    const aPayer = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut = 'approuve' AND statut_paiement = 'non_paye'");
    
    res.render('admin-dashboard', { 
        missions: missions.rows, users: users.rows, paiements: paiements.rows, formations: formations.rows,
        finance: { brut: brut.toFixed(2), tps: tps.toFixed(2), tvq: tvq.toFixed(2), total: (brut + tps + tvq).toFixed(2) },
        totalAPayer: aPayer.rows[0].total || 0, userName: req.session.userName 
    });
});
// (Autres routes admin inchangées : rapport-comptable, payer, approuver, create-user, delete-user, rapport/id...)
app.get('/admin/rapport-comptable', async (req, res) => {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf'); doc.pipe(res);
    doc.fontSize(20).text('RAPPORT COMPTABLE', {align:'center'}); doc.end();
});
app.post('/admin/payer-ambassadeur', async (req, res) => { await pool.query("UPDATE missions SET statut_paiement='paye' WHERE id=$1", [req.body.id_mission]); res.redirect('/admin/dashboard'); });
app.post('/admin/approuver-mission', async (req, res) => { await pool.query("UPDATE missions SET statut='approuve' WHERE id=$1", [req.body.id_mission]); res.redirect('/admin/dashboard'); });
app.post('/admin/create-user', async (req, res) => { const hash = await bcrypt.hash(req.body.password, 10); await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1,$2,$3,$4)", [req.body.nom, req.body.email, hash, req.body.role]); res.redirect('/admin/dashboard'); });
app.post('/admin/delete-user', async (req, res) => { await pool.query("DELETE FROM users WHERE id=$1", [req.body.user_id]); res.redirect('/admin/dashboard'); });
app.get('/admin/rapport/:missionId', async (req, res) => { const data = await pool.query(`SELECT r.*, m.titre, m.type_audit FROM audit_reports r JOIN missions m ON r.mission_id=m.id WHERE m.id=$1`, [req.params.missionId]); res.render('admin-rapport-detail', { rapport: data.rows[0], details: data.rows[0].details, userName: req.session.userName }); });


// ENTREPRISE (AVEC VUE FORMATIONS)
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
    
    // NOUVEAU : Récupérer les scores des employés de cette entreprise
    const scores = await pool.query(`
        SELECT u.nom as employe_nom, m.titre as module_titre, s.meilleur_score, s.statut, s.updated_at 
        FROM formations_scores s 
        JOIN users u ON s.user_id = u.id 
        JOIN formations_modules m ON s.module_id = m.id 
        WHERE u.entreprise_id = $1 
        ORDER BY s.updated_at DESC`, [req.session.userId]);

    res.render('entreprise-dashboard', { 
        user: user.rows[0], 
        missions: missions.rows, 
        scores: scores.rows, // On passe les scores à la vue
        userName: req.session.userName, 
        error: req.query.error 
    });
});
app.post('/entreprise/creer-audit', checkLimit, async (req, res) => { await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, adresse) VALUES ($1, $2, $3, 'Visite', $4, 'en_attente', $5)", [req.session.userId, req.body.titre, req.body.type_audit, req.body.recompense, req.body.adresse]); res.redirect('/entreprise/dashboard'); });
app.post('/entreprise/commander-sondage', checkLimit, async (req, res) => { await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, client_nom, client_email) VALUES ($1, $2, $3, 'Sondage', $4, 'en_attente', $5, $6)", [req.session.userId, "Sondage "+req.body.client_nom, req.body.type_sondage, req.body.recompense, req.body.client_nom, req.body.client_email]); res.redirect('/entreprise/dashboard'); });
app.post('/entreprise/ajouter-employe', async (req, res) => { // Ajouter un employé lié à l'entreprise
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", [req.body.nom, req.body.email, hash, req.session.userId]);
    res.redirect('/entreprise/dashboard');
});
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => { /* Code PDF inchangé */ const doc = new PDFDocument(); doc.pipe(res); doc.text('Rapport'); doc.end(); });

// AMBASSADEUR (Inchangé)
app.get('/ambassadeur/dashboard', async (req, res) => { const missions = await pool.query("SELECT * FROM missions WHERE statut='actif'"); const hist = await pool.query("SELECT * FROM missions WHERE ambassadeur_id=$1", [req.session.userId]); res.render('ambassadeur-dashboard', { missions: missions.rows, historique: hist.rows, totalGains: 0, userName: req.session.userName }); });
app.post('/ambassadeur/postuler', async (req, res) => { await pool.query("UPDATE missions SET ambassadeur_id=$1, statut='reserve' WHERE id=$2", [req.session.userId, req.body.id_mission]); res.redirect('/ambassadeur/dashboard'); });
app.post('/ambassadeur/soumettre-rapport', async (req, res) => { await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1,$2,$3)", [req.body.mission_id, req.session.userId, JSON.stringify(req.body)]); await pool.query("UPDATE missions SET statut='soumis' WHERE id=$1", [req.body.mission_id]); res.redirect('/ambassadeur/dashboard'); });

// --- ACADEMIE (EMPLOYÉ) : LOGIQUE 80% ---
app.get('/employe/dashboard', async (req, res) => {
    if (req.session.userRole !== 'employe') return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    const scores = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1", [req.session.userId]);
    res.render('employe-dashboard', { modules: modules.rows, scores: scores.rows, userName: req.session.userName });
});

app.get('/formations/module/:id', async (req, res) => {
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    res.render('formation-detail', { module: module.rows[0], questions: questions.rows, userName: req.session.userName });
});

app.post('/formations/soumettre-quizz', async (req, res) => {
    const moduleId = req.body.module_id;
    const questions = await pool.query("SELECT id, reponse_correcte FROM formations_questions WHERE module_id = $1", [moduleId]);
    
    let score = 0;
    let total = questions.rows.length; // Devrait être 5

    questions.rows.forEach(q => {
        if (req.body['q_' + q.id] === q.reponse_correcte) {
            score++;
        }
    });

    // RÈGLE DU 80%
    const pourcentage = (score / total) * 100;
    const statut = pourcentage >= 80 ? 'reussi' : 'echec'; // 4/5 minimum
    
    // Génération code certificat si réussi
    const code = statut === 'reussi' ? Math.random().toString(36).substring(2, 10).toUpperCase() : null;

    await pool.query(`
        INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) 
        VALUES ($1, $2, $3, 1, $4, $5) 
        ON CONFLICT (user_id, module_id) 
        DO UPDATE SET 
            meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), 
            tentatives = formations_scores.tentatives + 1, 
            statut = CASE WHEN formations_scores.statut = 'reussi' THEN 'reussi' ELSE EXCLUDED.statut END,
            code_verif = CASE WHEN formations_scores.code_verif IS NOT NULL THEN formations_scores.code_verif ELSE EXCLUDED.code_verif END
    `, [req.session.userId, moduleId, pourcentage, statut, code]);

    res.redirect('/employe/dashboard');
});

// CERTIFICAT
app.get('/certificat/:code', async (req, res) => {
    const data = await pool.query("SELECT s.*, u.nom, m.titre FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE s.code_verif = $1", [req.params.code]);
    if(data.rows.length === 0) return res.send("Certificat introuvable.");
    
    const doc = new PDFDocument({ layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    doc.rect(20, 20, 750, 550).strokeColor('#0061ff').lineWidth(5).stroke();
    doc.moveDown(4);
    doc.font('Helvetica-Bold').fontSize(35).fillColor('#0061ff').text('CERTIFICAT DE RÉUSSITE', {align:'center'});
    doc.moveDown();
    doc.fontSize(20).fillColor('black').text('Décerné à', {align:'center'});
    doc.moveDown();
    doc.fontSize(30).text(data.rows[0].nom, {align:'center'});
    doc.moveDown();
    doc.fontSize(15).text('Pour la réussite du module de formation :', {align:'center'});
    doc.fontSize(20).text(data.rows[0].titre, {align:'center'});
    doc.moveDown(3);
    doc.fontSize(12).text(`Délivré par FORFEO LAB ACADÉMIE - Code : ${data.rows[0].code_verif}`, {align:'center'});
    
    doc.end();
});

app.post('/api/chat', async (req, res) => {
    try {
        const completion = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "system", content: knowledgeBase }, { role: "user", content: req.body.message }] });
        res.json({ reply: completion.choices[0].message.content });
    } catch (err) { res.json({ reply: "Service indisponible." }); }
});

app.listen(port, () => console.log('🚀 LIVE'));
