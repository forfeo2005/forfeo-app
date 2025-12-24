<!DOCTYPE html>
<html lang="fr">
<head>
    <link rel="stylesheet" href="/css/style.css">
    <title>Administration | Forfeo</title>
</head>
<body>
    <nav>
        <strong>FORFEO LAB</strong>
        <div>
            <a href="/">Accueil</a>
            <a href="/admin">Console Admin</a>
            <a href="/entreprise/portail">Client</a>
        </div>
    </nav>

    <div class="container">
        <div class="card-section">
            <h2>Gestion des Talents (Ambassadeurs)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Nom Complet</th>
                        <th>Localisation</th>
                        <th>Email</th>
                        <th>État</th>
                        <th>Décision</th>
                    </tr>
                </thead>
                <tbody>
                    <% ambassadeurs.forEach(amb => { %>
                    <tr>
                        <td><strong><%= amb.nom %></strong></td>
                        <td><%= amb.ville %></td>
                        <td><%= amb.email %></td>
                        <td><%= amb.statut %></td>
                        <td>
                            <% if (amb.statut === 'En attente') { %>
                                <a href="/admin/approuver/<%= amb.id %>" class="btn-primary">Valider le profil</a>
                            <% } else { %>
                                <span style="color:green">Profil Actif</span>
                            <% } %>
                        </td>
                    </tr>
                    <% }) %>
                </tbody>
            </table>
        </div>

        <div class="card-section">
            <h2>Suivi des Missions Global</h2>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Type de Mission</th>
                        <th>Statut</th>
                    </tr>
                </thead>
                <tbody>
                    <% missions.forEach(m => { %>
                    <tr>
                        <td>#<%= m.id %></td>
                        <td><%= m.type_mission %></td>
                        <td><%= m.statut %></td>
                    </tr>
                    <% }) %>
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>
