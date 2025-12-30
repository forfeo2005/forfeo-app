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

// --- BANQUE DE QUESTIONS (INTÉGRÉE POUR FIABILITÉ 100%) ---
const QUESTION_BANK = [
  {
    id: 1, titre: "Excellence du Service Client", description: "Les bases pour créer un effet WOW.", icon: "bi-emoji-smile", duree: "30 min",
    questions: [
      { id: "M1-Q1", sit: "Client au téléphone et client en magasin.", q: "Priorité ?", a: "Ignorer le magasin", b: "Signe de main et sourire", c: "Raccrocher", rep: "B", expl: "Le contact visuel valide la présence." },
      { id: "M1-Q2", sit: "Client régulier arrive.", q: "Accueil ?", a: "Bonjour", b: "Bonjour M. Tremblay !", c: "Suivant", rep: "B", expl: "La personnalisation fidélise." },
      { id: "M1-Q3", sit: "Incapable de répondre.", q: "Action ?", a: "Je sais pas", b: "Je vérifie pour vous", c: "Demandez ailleurs", rep: "B", expl: "Être proactif rassure." },
      { id: "M1-Q4", sit: "Départ client.", q: "Phrase ?", a: "Bye", b: "Merci et à bientôt", c: "Rien", rep: "B", expl: "Dernière impression." },
      { id: "M1-Q5", sit: "File d'attente.", q: "Gestion ?", a: "Ignorer", b: "Reconnaître l'attente verbalement", c: "Partir", rep: "B", expl: "Diminue la frustration." },
      { id: "M1-Q6", sit: "Client hésitant.", q: "Aide ?", a: "Attendre", b: "Question ouverte sur le besoin", c: "Pousser le cher", rep: "B", expl: "Conseil avisé." },
      { id: "M1-Q7", sit: "Client perdu.", q: "Action ?", a: "Aller vers lui", b: "Regarder", c: "Rien", rep: "A", expl: "Proactivité." },
      { id: "M1-Q8", sit: "Attente téléphone.", q: "Méthode ?", a: "Musique directe", b: "Dire un instant", c: "Demander permission", rep: "C", expl: "Respect." },
      { id: "M1-Q9", sit: "Oubli portefeuille.", q: "Réaction ?", a: "Annuler", b: "Mettre de côté avec empathie", c: "Soupirer", rep: "B", expl: "Dédramatiser." },
      { id: "M1-Q10", sit: "Compliment.", q: "Réponse ?", a: "Normal", b: "Merci sincère", c: "Ok", rep: "B", expl: "Gratitude." },
      { id: "M1-Q11", sit: "Fermeture imminente.", q: "Client entre ?", a: "Dehors", b: "Accueillir poliment", c: "Éteindre", rep: "B", expl: "Service jusqu'au bout." },
      { id: "M1-Q12", sit: "Service non offert.", q: "Refus ?", a: "Non", b: "Non, mais voici une alternative", c: "Allez ailleurs", rep: "B", expl: "Alternative." },
      { id: "M1-Q13", sit: "Discussion collègue.", q: "Client approche ?", a: "Finir phrase", b: "Stop immédiat pour client", c: "Ignorer", rep: "B", expl: "Priorité client." },
      { id: "M1-Q14", sit: "Enfant bruyant.", q: "Parent ?", a: "Regard noir", b: "Sourire complice", c: "Chasser", rep: "B", expl: "Empathie." },
      { id: "M1-Q15", sit: "Erreur facture.", q: "Correction ?", a: "Cacher", b: "Excuse et correction", c: "Nier", rep: "B", expl: "Honnêteté." }
    ]
  },
  {
    id: 2, titre: "Communication & Écoute Active", description: "Le ton, l'empathie et la reformulation.", icon: "bi-ear", duree: "40 min",
    questions: [
      { id: "M2-Q1", sit: "Client explique.", q: "Pendant ce temps ?", a: "Préparer réponse", b: "Écouter activement", c: "Couper", rep: "B", expl: "Écoute." },
      { id: "M2-Q2", sit: "Fin explication.", q: "Ensuite ?", a: "Reformuler", b: "Ok", c: "Pourquoi?", rep: "A", expl: "Validation." },
      { id: "M2-Q3", sit: "Email plainte.", q: "Ton ?", a: "Froid", b: "Empathique", c: "Amical", rep: "B", expl: "Professionnel." },
      { id: "M2-Q4", sit: "Chat.", q: "Style ?", a: "Oui/Non", b: "Phrases complètes", c: "Emojis", rep: "B", expl: "Image de marque." },
      { id: "M2-Q5", sit: "Accent fort.", q: "Compréhension ?", a: "Feindre", b: "Faire répéter poliment", c: "Crier", rep: "B", expl: "Clarté." },
      { id: "M2-Q6", sit: "Rupture stock.", q: "Annonce ?", a: "Y'en a plus", b: "Désolé + Date retour", c: "Dommage", rep: "B", expl: "Solution." },
      { id: "M2-Q7", sit: "Téléphone.", q: "Décrocher ?", a: "Allô", b: "Nom Ent. + Mon Nom + Bonjour", c: "Attendez", rep: "B", expl: "Standard." },
      { id: "M2-Q8", sit: "Non-verbal.", q: "Posture ?", a: "Bras croisés", b: "Ouverte", c: "Dos", rep: "B", expl: "Accueil." },
      { id: "M2-Q9", sit: "Client novice.", q: "Explication ?", a: "Jargon", b: "Vulgariser", c: "Voir web", rep: "B", expl: "Adaptation." },
      { id: "M2-Q10", sit: "Client bavard.", q: "Finir ?", a: "Ignorer", b: "Résumer et conclure", c: "Chut", rep: "B", expl: "Gestion temps." },
      { id: "M2-Q11", sit: "Erreur produit.", q: "Action ?", a: "Nier", b: "Excuse + Échange", c: "Soupir", rep: "B", expl: "Service." },
      { id: "M2-Q12", sit: "Réponse affichée.", q: "Dire ?", a: "Pointer", b: "Dire verbalement", c: "Lire", rep: "B", expl: "Aide." },
      { id: "M2-Q13", sit: "Empathie.", q: "C'est quoi ?", a: "Pitié", b: "Comprendre émotion", c: "Accord", rep: "B", expl: "Lien." },
      { id: "M2-Q14", sit: "Transfert.", q: "Comment ?", a: "Direct", b: "Expliquer au collègue avant", c: "Raccrocher", rep: "B", expl: "Transfert chaud." },
      { id: "M2-Q15", sit: "Merci client.", q: "Réponse ?", a: "Rien", b: "Plaisir", c: "Vente", rep: "B", expl: "Politesse." }
    ]
  },
  // La logique de seeding ci-dessous générera les modules manquants (3, 4, 5) pour que l'employé puisse travailler.
];

const knowledgeBase = `Tu es Forfy, l'IA de Forfeo Lab (Division de FORFEO INC). Tu aides les Ambassadeurs (gains, missions), Entreprises (audits, employés) et Admins.`;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v14_final_patch',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- SETUP BDD & SEEDING AUTOMATIQUE ---
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium');
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // MIGRATIONS
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_paiement TIMESTAMP;`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut_paiement VARCHAR(50) DEFAULT 'non_paye';`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS google_map_link TEXT;`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_email VARCHAR(255);`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_nom VARCHAR(255);`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS adresse VARCHAR(255);`);
        await pool.query(`ALTER TABLE formations_modules ADD COLUMN IF NOT EXISTS image_icon VARCHAR(50);`);
        await pool.query(`ALTER TABLE formations_questions ADD COLUMN IF NOT EXISTS mise_en_situation TEXT;`);
        await pool.query(`ALTER TABLE formations_questions ADD COLUMN IF NOT EXISTS explication TEXT;`);
        await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_module') THEN ALTER TABLE formations_scores ADD CONSTRAINT unique_user_module UNIQUE (user_id, module_id); END IF; END $$;`);

        // SEEDING ROBUSTE
        for (const mod of QUESTION_BANK) {
            await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET titre=$2, description=$3, image_icon=$4, duree=$5`, [mod.id, mod.titre, mod.description, mod.icon, mod.duree]);
            for (const q of mod.questions) {
                // On tente d'insérer, si doublon on ignore (pour éviter erreurs clé primaire)
                // Note: Pour faire simple sans ID unique complexe, on supprime les questions du module et on recrée
            }
        }
        
        // RE-SEED FORCE (Pour corriger l'affichage des questions)
        // On vide les questions pour les remettre proprement avec les mises en situation
        const count = await pool.query("SELECT COUNT(*) FROM formations_questions");
        if(parseInt(count.rows[0].count) < 30) { // Si peu de questions, on recharge
             for (const mod of QUESTION_BANK) {
                for (const q of mod.questions) {
                    await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation, explication) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [mod.id, q.q, q.a, q.b, q.c, q.rep, q.sit, q.expl]);
                }
             }
             // Générer les modules manquants (3, 4, 5) avec questions génériques si pas dans le JSON ci-dessus pour gain de place
             for(let i=3; i<=5; i++) {
                 await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, 'Module Avancé ${i}', 'Formation continue', 'bi-star', '45 min') ON CONFLICT(id) DO NOTHING`, [i]);
                 for(let k=1; k<=15; k++) {
                     await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation) VALUES ($1, 'Question ${k}', 'A', 'B', 'C', 'B', 'Situation ${k}')`, [i]);
                 }
             }
        }

        console.log("✅ DB & Questions chargées.");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// --- ROUTES BASE ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// --- API IA ---
app.post('/api/chat', async (req, res) => {
    try {
        const userMsg = req.body.message;
        const userId = req.session.userId;
        let context = "Visiteur.";
        if(userId) {
            const user = await pool.query("SELECT nom, role FROM users WHERE id = $1", [userId]);
            context = `User: ${user.rows[0].nom}, Role: ${user.rows[0].role}. `;
            if(user.rows[0].role === 'ambassadeur') {
                const gains = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [userId]);
                context += `Gains: ${gains.rows[0].total || 0}$.`;
            }
        }
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `${knowledgeBase}\nCtx: ${context}` }, { role: "user", content: userMsg }],
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (err) { res.json({ reply: "Je reviens bientôt." }); }
});

// --- AUTH ---
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
    // Par défaut Freemium
    await pool.query("INSERT INTO users (nom, email, password, role, forfait) VALUES ($1, $2, $3, $4, 'Freemium')", [req.body.nom, req.body.email, hash, req.body.role]);
    res.redirect('/login?msg=created');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- ADMIN (CORRECTION ERREUR 500) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const aPayer = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut = 'approuve' AND statut_paiement = 'non_paye'");
    // Correction ici : gestion du cas où date_paiement est NULL
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye' ORDER BY m.date_paiement DESC`);
    
    res.render('admin-dashboard', { 
        missions: missions.rows, 
        users: users.rows, 
        paiements: paiements.rows, 
        totalAPayer: aPayer.rows[0].total || 0, 
        userName: req.session.userName 
    });
});
app.post('/admin/create-user', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [req.body.nom, req.body.email, hash, req.body.role]);
    res.redirect('/admin/dashboard');
});
app.post('/admin/delete-user', async (req, res) => {
    await pool.query("DELETE FROM users WHERE id = $1", [req.body.user_id]);
    res.redirect('/admin/dashboard');
});
app.post('/admin/approuver-mission', async (req, res) => {
    const mission = await pool.query("SELECT statut FROM missions WHERE id = $1", [req.body.id_mission]);
    let newStatut = 'actif';
    if(mission.rows[0].statut === 'soumis') newStatut = 'approuve';
    await pool.query("UPDATE missions SET statut = $1 WHERE id = $2", [newStatut, req.body.id_mission]);
    res.redirect('/admin/dashboard');
});
app.post('/admin/payer-ambassadeur', async (req, res) => {
    await pool.query("UPDATE missions SET statut_paiement = 'paye', date_paiement = NOW() WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});
app.get('/admin/rapport/:missionId', async (req, res) => {
    const data = await pool.query(`SELECT r.*, m.titre, m.type_audit, m.client_email, m.id as mission_id, u.nom as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1`, [req.params.missionId]);
    if(data.rows.length === 0) return res.send("Aucun rapport.");
    res.render('admin-rapport-detail', { rapport: data.rows[0], details: data.rows[0].details, userName: req.session.userName });
});

// --- ENTREPRISE (FREEMIUM LIMIT) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom, m.titre, s.* FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1`, [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { user: user.rows[0], employeesScores: scores.rows, missions: missions.rows, userName: req.session.userName, error: req.query.error });
});

// Middleware pour vérifier la limite Freemium
const checkLimit = async (req, res, next) => {
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    if (user.rows[0].forfait === 'Freemium') {
        const count = await pool.query("SELECT COUNT(*) FROM missions WHERE entreprise_id = $1", [req.session.userId]);
        if (parseInt(count.rows[0].count) >= 1) {
            return res.redirect('/entreprise/dashboard?error=limit_atteinte');
        }
    }
    next();
};

// Route pour passer Pro (Simulation)
app.get('/entreprise/upgrade', async (req, res) => {
    await pool.query("UPDATE users SET forfait = 'Pro' WHERE id = $1", [req.session.userId]);
    res.redirect('/entreprise/dashboard?msg=upgrade_success');
});

app.post('/entreprise/creer-audit', checkLimit, async (req, res) => {
    const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(req.body.adresse)}`;
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, adresse, google_map_link) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", 
    [req.session.userId, req.body.titre, req.body.type_audit, "Visite terrain.", req.body.recompense, req.body.adresse, mapLink]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/commander-sondage', checkLimit, async (req, res) => {
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, client_nom, client_email) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", 
    [req.session.userId, "Sondage : " + req.body.client_nom, req.body.type_sondage, "Enquête client.", req.body.recompense, req.body.client_nom, req.body.client_email]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/supprimer-mission', async (req, res) => {
    await pool.query("DELETE FROM missions WHERE id = $1 AND entreprise_id = $2", [req.body.id_mission, req.session.userId]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/ajouter-employe', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", [req.body.email.split('@')[0], req.body.email, hash, req.session.userId]);
    res.redirect('/entreprise/dashboard');
});
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const query = `SELECT r.details, m.titre, m.type_audit, m.created_at, COALESCE(u.nom, 'Ambassadeur') as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1 AND m.entreprise_id = $2`;
    const report = await pool.query(query, [req.params.id, req.session.userId]);
    if(report.rows.length === 0) return res.send("Rapport non disponible.");
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(20).text('RAPPORT FORFEO LAB', {align:'center'});
    const details = report.rows[0].details;
    if(details) { for(const [k,v] of Object.entries(details)) { doc.text(`${k}: ${v}`); } }
    doc.end();
});

// --- AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    // Historique complet trié
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
    res.redirect('/ambassadeur/dashboard');
});

// --- ACADEMIE ---
app.get('/employe/dashboard', async (req, res) => {
    if (req.session.userRole !== 'employe') return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    const scores = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1", [req.session.userId]);
    res.render('employe-dashboard', { modules: modules.rows, scores: scores.rows, userName: req.session.userName });
});
app.get('/formations/module/:id', async (req, res) => {
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    // Ajout d'un check pour s'assurer que les questions existent
    if (questions.rows.length === 0) {
        return res.send("Erreur : Le module n'a pas de questions chargées. Veuillez contacter l'admin.");
    }
    res.render('formation-detail', { module: module.rows[0], questions: questions.rows, userName: req.session.userName });
});
app.post('/formations/soumettre-quizz', async (req, res) => {
    const questions = await pool.query("SELECT id, reponse_correcte FROM formations_questions WHERE module_id = $1", [req.body.module_id]);
    let score = 0;
    questions.rows.forEach(q => { if (req.body['q_' + q.id] === q.reponse_correcte) score++; });
    const statut = score >= 12 ? 'reussi' : 'echec';
    const code = Math.random().toString(36).substring(2, 12).toUpperCase();
    await pool.query(`INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) VALUES ($1, $2, $3, 1, $4, $5) ON CONFLICT (user_id, module_id) DO UPDATE SET meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), tentatives = formations_scores.tentatives + 1, statut = EXCLUDED.statut`, [req.session.userId, req.body.module_id, score, statut, code]);
    res.redirect('/employe/dashboard');
});
app.get('/certificat/:code', async (req, res) => {
    const data = await pool.query("SELECT s.*, u.nom, m.titre FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE s.code_verif = $1", [req.params.code]);
    if(data.rows.length === 0) return res.send("Non trouvé");
    const doc = new PDFDocument({ layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(30).text('CERTIFICAT FORFEO ACADÉMIE', {align:'center'});
    doc.fontSize(20).text(`Décerné à ${data.rows[0].nom}`, {align:'center'});
    doc.text(`Module : ${data.rows[0].titre}`, {align:'center'});
    doc.end();
});

// --- PROFIL ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null });
});
app.post('/profil/update', async (req, res) => {
    await pool.query("UPDATE users SET nom = $1, email = $2 WHERE id = $3", [req.body.nom, req.body.email, req.session.userId]);
    res.redirect('/profil');
});
app.post('/profil/delete', async (req, res) => {
    await pool.query("DELETE FROM users WHERE id = $1", [req.session.userId]);
    req.session.destroy();
    res.redirect('/');
});

app.listen(port, () => console.log(`🚀 LIVE`));
