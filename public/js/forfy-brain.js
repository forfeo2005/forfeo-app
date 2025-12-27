document.addEventListener('DOMContentLoaded', () => {
    const chatBtn = document.getElementById('forfy-btn');
    const chatWindow = document.getElementById('forfy-chat');
    const msgs = document.getElementById('forfy-msgs');
    const input = document.getElementById('forfy-input');

    if (chatBtn) {
        chatBtn.onclick = () => chatWindow.style.display = chatWindow.style.display === 'none' ? 'block' : 'none';
    }

    input.onkeypress = async (e) => {
        if (e.key === 'Enter' && input.value.trim() !== "") {
            const userText = input.value;
            msgs.innerHTML += `<div style="margin-bottom:10px;"><b>Moi:</b> ${userText}</div>`;
            
            // AFFICHAGE DU GIF/VIDÉO FORFY PENDANT LA RÉFLEXION
            const loadingId = "loading-" + Date.now();
            msgs.innerHTML += `
                <div id="${loadingId}" style="margin-bottom:10px;">
                    <video src="/GifForfy.MP4" autoplay loop muted style="width:60px; border-radius:10px;"></video>
                </div>`;
            
            input.value = "";
            msgs.scrollTop = msgs.scrollHeight;

            const res = await fetch('/forfy/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ message: userText })
            });
            const data = await res.json();
            
            // On enlève l'animation et on met la réponse (Fini le "undefined")
            document.getElementById(loadingId).remove();
            msgs.innerHTML += `<div style="margin-bottom:10px; color:#0d6efd;"><b>Forfy:</b> ${data.answer}</div>`;
            msgs.scrollTop = msgs.scrollHeight;
        }
    };
});
