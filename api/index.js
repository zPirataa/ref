const http = require('http');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Definir o caminho do config.json (Pode estar na pasta raiz ou na pasta api)
let configGlobal = {
    discord: { clientId: "", botToken: "", targetUserId: "" },
    supabaseUrl: "",
    supabaseKey: ""
};

try {
    const pathsToTry = [
        path.join(__dirname, 'config.json'),
        path.join(__dirname, '..', 'config.json')
    ];
    for (const p of pathsToTry) {
        if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            configGlobal = { ...configGlobal, ...data };
            break;
        }
    }
} catch (e) {
    console.log("Config local não carregado. Usando ambiente.");
}

// Configurações finais (Vercel env vars primeiro)
const supabaseUrl = process.env.SUPABASE_URL || process.env.supabaseUrl || configGlobal.supabaseUrl;
const supabaseKey = process.env.SUPABASE_KEY || process.env.supabaseKey || configGlobal.supabaseKey;
const botToken = process.env.BOT_TOKEN || process.env.botToken || configGlobal.discord?.botToken;
const targetUserId = process.env.TARGET_USER_ID || process.env.targetUserId || configGlobal.discord?.targetUserId;
const clientId = process.env.CLIENT_ID || process.env.clientId || configGlobal.discord?.clientId;

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
const PORT = process.env.PORT || configGlobal.server?.port || 3000;

// O Handler principal compatível com Vercel e Local
const handler = async (req, res) => {
    try {
        // CORS simplificado
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Servir a página principal HTML
        if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html' || (req.url && req.url.includes('?')))) {
            const indexPath = fs.existsSync(path.join(__dirname, 'index.html'))
                ? path.join(__dirname, 'index.html')
                : path.join(__dirname, '..', 'index.html');

            fs.readFile(indexPath, (err, content) => {
                if (err) {
                    res.writeHead(500);
                    res.end('Erro ao carregar o arquivo index.html no servidor.');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(content, 'utf-8');
                }
            });
        } 
        // Rota GET: Resgatar as configurações estéticas e não sensíveis para o Front
        else if (req.method === 'GET' && req.url.includes('/api/config')) {
            const clientSafeConfig = {
                clientId: clientId,
                targetUserId: targetUserId,
                theme: configGlobal.theme || {}
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(clientSafeConfig));
        }
        // Rota GET: Buscar a foto/nome atualizados do criador direto no Discord
        else if (req.method === 'GET' && req.url.includes('/api/user')) {
            if (!botToken || !targetUserId) {
                res.writeHead(200);
                return res.end(JSON.stringify({ success: false, message: 'Configurações do Discord ausentes.' }));
            }

            const response = await fetch(`https://discord.com/api/v10/users/${targetUserId}`, {
                headers: { "Authorization": `Bot ${botToken.trim()}` }
            });
            const data = await response.json();

            if (data.id) {
                let avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
                if (data.avatar) {
                    const ext = data.avatar.startsWith("a_") ? "gif" : "png";
                    avatarUrl = `https://cdn.discordapp.com/avatars/${targetUserId}/${data.avatar}.${ext}?size=1024`;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                const displayName = data.global_name || data.username;
                const tag = "@" + data.username;
                const profile = configGlobal.discord?.profile || {};
                
                res.end(JSON.stringify({ 
                    success: true, 
                    id: data.id,
                    avatarUrl: avatarUrl, 
                    username: displayName,
                    tag: tag,
                    banner: data.banner ? `https://cdn.discordapp.com/banners/${data.id}/${data.banner}.${data.banner.startsWith("a_") ? "gif" : "png"}?size=1024` : null,
                    accentColor: data.accent_color ? `#${data.accent_color.toString(16).padStart(6, '0')}` : null,
                    bio: profile.bio || data.bio || "",
                    publicFlags: data.public_flags || 0,
                    showNitro: !!profile.showNitro,
                    showBoost: !!profile.showBoost
                }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ success: false }));
            }
        } 
        // Rota GET: Retornar todos os itens do Supabase
        else if (req.method === 'GET' && req.url.includes('/api/reviews')) {
            if (!supabase) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify([]));
            }
            const { data, error } = await supabase.from('reviews').select('*').order('id', { ascending: false });
            if (error) {
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: error.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data || []));
            }
        } 
        // Rota POST: Salvar nova avaliação
        else if (req.method === 'POST' && req.url.includes('/api/reviews')) {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    const discordRes = await fetch('https://discord.com/api/v10/users/@me', {
                        headers: { "Authorization": `Bearer ${payload.accessToken}` }
                    });
                    if (!discordRes.ok) {
                        res.writeHead(401);
                        return res.end(JSON.stringify({ success: false, message: 'Sessão expirada.' }));
                    }
                    const discordUser = await discordRes.json();
                    const avatarExt = discordUser.avatar && discordUser.avatar.startsWith("a_") ? "gif" : "png";
                    const userAvatarUrl = discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${avatarExt}?size=256` : "https://cdn.discordapp.com/embed/avatars/0.png";

                    const { data: dbData, error: dbError } = await supabase.from('reviews').insert([{
                        username: discordUser.global_name || discordUser.username,
                        tag: discordUser.username,
                        user_id: discordUser.id,
                        avatar_url: userAvatarUrl,
                        rating: payload.rating,
                        review_text: payload.text,
                        display_date: new Date().toLocaleDateString('pt-BR') + ' - ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    }]).select();

                    if (dbError) throw dbError;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, review: dbData[0] }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, message: 'Erro ao salvar.' }));
                }
            });
        }
        // Rota DELETE: Apagar avaliação
        else if (req.method === 'DELETE' && req.url.includes('/api/reviews')) {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    const discordRes = await fetch('https://discord.com/api/v10/users/@me', {
                        headers: { "Authorization": `Bearer ${payload.accessToken}` }
                    });
                    const discordUser = await discordRes.json();
                    if (discordUser.id !== targetUserId) {
                        res.writeHead(403);
                        return res.end(JSON.stringify({ success: false, message: 'Acesso negado.' }));
                    }
                    const { error: delError } = await supabase.from('reviews').delete().eq('id', payload.id);
                    if (delError) throw delError;
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false }));
                }
            });
        }
        else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Não encontrado' }));
        }
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
    }
};

module.exports = handler;

if (require.main === module || !process.env.VERCEL) {
    const server = http.createServer(handler);
    server.listen(PORT, () => {
        console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    });
}
