document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('forfy-btn');
    const chat = document.getElementById('forfy-chat');
    const msgs = document.getElementById('forfy-msgs');
    const input = document.getElementById('forfy-input');

    btn.onclick = () => chat.style.display = chat.style.display === 'none' ? 'block' : 'none';

    input.onkeypress = async (e) => {
        if (e.key === 'Enter' && input.value.trim() !== "") {
            const userText = input.value;
            msgs.innerHTML += `<div class="mb-2"><b>Moi:</b> ${userText}</div>`;
            
            // AFFICHAGE DU CHIEN QUI RÉFLÉCHIT
            const loadId = "load-" + Date.now();
            msgs.innerHTML += `<div id="${loadId}" class="mb-2"><video src="/GifForfy.MP4" autoplay loop muted style="width:65px; border-radius:10px;"></video></div>`;
            
            input.value = "";
            msgs.scrollTop = msgs.scrollHeight;

            const res = await fetch('/forfy/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ message: userText })
            });
            const data = await res.json();
            
            document.getElementById(loadId).remove();
            msgs.innerHTML += `<div class="mb-2" style="color:#0d6efd;"><b>Forfy:</b> ${data.answer}</div>`;
            msgs.scrollTop = msgs.scrollHeight;
        }
    };
});
