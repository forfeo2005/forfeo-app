document.addEventListener('DOMContentLoaded', () => {
    const forfyHTML = `
        <div id="f-ui" style="position: fixed; bottom: 20px; right: 20px; z-index: 9999;">
            <button id="f-btn" style="width: 55px; height: 55px; border-radius: 50%; border: none; background: #0d6efd; color: white; font-size: 22px; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">🤖</button>
            <div id="f-chat" style="display: none; position: absolute; bottom: 70px; right: 0; width: 280px; background: white; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); border: 1px solid #ddd; overflow: hidden;">
                <div style="background: #0d6efd; color: white; padding: 10px; font-weight: bold; font-size: 14px;">Forfy - Assistant FORFEO</div>
                <div id="f-msgs" style="height: 250px; overflow-y: auto; padding: 10px; font-size: 12px;"></div>
                <input type="text" id="f-in" style="width: 100%; border: none; padding: 10px; border-top: 1px solid #eee; outline: none;" placeholder="Posez une question...">
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', forfyHTML);

    const btn = document.getElementById('f-btn');
    const chat = document.getElementById('f-chat');
    const input = document.getElementById('f-in');
    const msgs = document.getElementById('f-msgs');

    btn.onclick = () => chat.style.display = chat.style.display === 'none' ? 'block' : 'none';

    input.onkeypress = async (e) => {
        if (e.key === 'Enter' && input.value.trim() !== "") {
            const txt = input.value;
            msgs.innerHTML += `<div><b>Moi:</b> ${txt}</div>`;
            input.value = "";
            const res = await fetch('/forfy/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ message: txt })
            });
            const data = await res.json();
            msgs.innerHTML += `<div style="color:#0d6efd;"><b>Forfy:</b> ${data.answer}</div>`;
            msgs.scrollTop = msgs.scrollHeight;
        }
    };
});
