document.addEventListener('DOMContentLoaded', () => {
    const forfyHTML = `
        <div id="forfy-ui" style="position: fixed; bottom: 20px; right: 20px; z-index: 9999;">
            <button id="forfy-btn" style="width: 60px; height: 60px; border-radius: 50%; border: none; background: #0d6efd; color: white; font-size: 24px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">🤖</button>
            <div id="forfy-chat" style="display: none; position: absolute; bottom: 80px; right: 0; width: 300px; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 1px solid #ddd; overflow: hidden;">
                <div style="background: #0d6efd; color: white; padding: 10px 15px; font-weight: bold;">Forfy - Cerveau IA</div>
                <div id="forfy-msgs" style="height: 300px; overflow-y: auto; padding: 15px; font-size: 13px;"></div>
                <input type="text" id="forfy-in" style="width: 100%; border: none; padding: 12px; border-top: 1px solid #eee; outline: none;" placeholder="Posez-moi une question...">
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', forfyHTML);

    const btn = document.getElementById('forfy-btn');
    const chat = document.getElementById('forfy-chat');
    const input = document.getElementById('forfy-in');
    const msgs = document.getElementById('forfy-msgs');

    btn.onclick = () => chat.style.display = chat.style.display === 'none' ? 'block' : 'none';

    input.onkeypress = async (e) => {
        if (e.key === 'Enter' && input.value.trim() !== "") {
            const userText = input.value;
            msgs.innerHTML += `<div style="margin-bottom: 10px;"><b>Moi:</b> ${userText}</div>`;
            input.value = "";
            const res = await fetch('/forfy/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ message: userText })
            });
            const data = await res.json();
            msgs.innerHTML += `<div style="margin-bottom: 10px; color: #0d6efd;"><b>Forfy:</b> ${data.answer}</div>`;
            msgs.scrollTop = msgs.scrollHeight;
        }
    };
});
