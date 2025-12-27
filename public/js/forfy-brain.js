document.addEventListener('DOMContentLoaded', () => {
    const forfyBtn = document.getElementById('forfy-btn');
    const chatBox = document.getElementById('forfy-chat');
    const msgs = document.getElementById('forfy-msgs');
    const input = document.getElementById('forfy-input');

    if (forfyBtn) {
        forfyBtn.onclick = () => {
            chatBox.style.display = chatBox.style.display === 'none' ? 'block' : 'none';
        };
    }

    input.onkeypress = async (e) => {
        if (e.key === 'Enter' && input.value.trim() !== "") {
            const userText = input.value;
            msgs.innerHTML += `<div style="margin-bottom:10px;"><b>Moi:</b> ${userText}</div>`;
            
            // Affichage du GIF Forfy pendant qu'il réfléchit
            const loadingId = "loading-" + Date.now();
            msgs.innerHTML += `
                <div id="${loadingId}" style="margin-bottom:10px;">
                    <video src="/GifForfy.MP4" autoplay loop muted style="width:60px; border-radius:10px;"></video>
                </div>`;
            
            input.value = "";
            msgs.scrollTop = msgs.scrollHeight;

            try {
                const response = await fetch('/forfy/chat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ message: userText })
                });
                const data = await response.json();
                
                // On enlève le GIF et on met la réponse
                document.getElementById(loadingId).remove();
                msgs.innerHTML += `<div style="margin-bottom:10px; color:#0d6efd;"><b>Forfy:</b> ${data.answer}</div>`;
            } catch (err) {
                document.getElementById(loadingId).remove();
                msgs.innerHTML += `<div style="margin-bottom:10px; color:red;"><b>Forfy:</b> Oups, j'ai eu un bug !</div>`;
            }
            msgs.scrollTop = msgs.scrollHeight;
        }
    };
});
