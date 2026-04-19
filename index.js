const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const crypto = require('crypto');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Database setup
let db;

async function setupDatabase() {
    db = await open({
        filename: './licenses.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS licenses (
            key TEXT PRIMARY KEY,
            tier TEXT DEFAULT 'Premium',
            expires_at INTEGER,
            redeemed_by TEXT,
            redeemed_at INTEGER,
            hwid TEXT
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY,
            license_key TEXT,
            redeemed_at INTEGER,
            hwid TEXT
        )
    `);
}

// Generate license key
function generateLicenseKey() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segments = [];
    for (let i = 0; i < 3; i++) {
        let segment = '';
        for (let j = 0; j < 4; j++) {
            segment += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        segments.push(segment);
    }
    return segments.join('-');
}

// Hash HWID
function hashHWID(hwid) {
    return crypto.createHash('sha256').update(hwid).digest('hex');
}

// Create license panel embed
function createLicensePanel() {
    const embed = new EmbedBuilder()
        .setTitle('License Panel')
        .setDescription('Welcome! Use the buttons below to manage your license.\n\n' +
            '• **Redeem Key** — Link a license key to your account\n' +
            '• **My Stats** — View your subscription & HWID\n' +
            '• **Reset HWID** — Clear your bound machine (24h cooldown)\n' +
            '• **Generate Key** — *(Admin only)* Create a new license\n\n' +
            '*Only you can see responses from these buttons.*')
        .setColor(0x2b2d31)
        .setFooter({ text: 'No Mercy Panel • APP' })
        .setTimestamp();

    return embed;
}

// Create buttons
function createButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('redeem_key')
                .setLabel('Redeem Key')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('my_stats')
                .setLabel('My Stats')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('reset_hwid')
                .setLabel('Reset HWID')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('generate_key')
                .setLabel('Generate Key')
                .setStyle(ButtonStyle.Success)
        );
}

// Admin check
function isAdmin(member) {
    return member.permissions.has('Administrator') || member.roles.cache.some(role => role.name === 'Admin');
}

// Handle redeem key
async function handleRedeemKey(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('redeem_modal')
        .setTitle('Redeem License Key');

    const keyInput = new TextInputBuilder()
        .setCustomId('license_key')
        .setLabel('Enter your license key')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('XXXX-XXXX-XXXX')
        .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(keyInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
}

// Handle my stats
async function handleMyStats(interaction) {
    const user = await db.get('SELECT * FROM users WHERE discord_id = ?', interaction.user.id);

    if (!user || !user.license_key) {
        const embed = new EmbedBuilder()
            .setTitle('Your License Stats')
            .setDescription('❌ **No license found**\n\nYou don\'t have an active license. Use the **Redeem Key** button to activate one.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const license = await db.get('SELECT * FROM licenses WHERE key = ?', user.license_key);
    
    if (!license) {
        const embed = new EmbedBuilder()
            .setTitle('Your License Stats')
            .setDescription('❌ **License invalid**\n\nYour license is no longer valid.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const now = Date.now();
    const expiresAt = license.expires_at;
    const timeLeft = expiresAt - now;
    
    let status = '❌ Expired';
    let statusColor = 0xff0000;
    
    if (timeLeft > 0) {
        status = '✅ Active';
        statusColor = 0x00ff00;
    }
    
    const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hoursLeft = Math.floor((timeLeft % (86400000)) / (1000 * 60 * 60));
    
    const expiryText = timeLeft > 0 ? `${daysLeft}d ${hoursLeft}h` : 'Expired';
    
    const maskedKey = license.key.substring(0, 4) + '***' + license.key.substring(license.key.length - 4);
    
    const embed = new EmbedBuilder()
        .setTitle('Your License Stats')
        .setDescription(`**Status**\n- ${status}\n\n**Tier**\n- ${license.tier}\n\n**Expires**\n- ${expiryText}\n\n**HWID**\n- ${user.hwid ? '✅ Bound' : '❌ Not bound yet'}\n\n**Key:** ${maskedKey}`)
        .setColor(statusColor)
        .setFooter({ text: 'Only you can see this' });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Handle reset HWID
async function handleResetHwid(interaction) {
    const user = await db.get('SELECT * FROM users WHERE discord_id = ?', interaction.user.id);
    
    if (!user || !user.license_key) {
        const embed = new EmbedBuilder()
            .setTitle('Reset HWID')
            .setDescription('❌ **No license found**\n\nYou need an active license to reset HWID.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Check if user has a cooldown (24 hours)
    const lastReset = user.last_reset || 0;
    const cooldown = 24 * 60 * 60 * 1000;
    const timeSinceLastReset = Date.now() - lastReset;
    
    if (timeSinceLastReset < cooldown) {
        const hoursLeft = Math.ceil((cooldown - timeSinceLastReset) / (1000 * 60 * 60));
        const embed = new EmbedBuilder()
            .setTitle('Reset HWID')
            .setDescription(`❌ **Cooldown active**\n\nYou can reset your HWID again in ${hoursLeft} hours.\n\n*HWID resets have a 24-hour cooldown.*`)
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Reset HWID
    await db.run('UPDATE users SET hwid = NULL, last_reset = ? WHERE discord_id = ?', Date.now(), interaction.user.id);
    
    const embed = new EmbedBuilder()
        .setTitle('Reset HWID')
        .setDescription('✅ **HWID Reset Successfully**\n\nYour HWID has been cleared. You can now bind a new machine.\n\n*Next reset available in 24 hours.*')
        .setColor(0x00ff00);
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Handle generate key (admin only)
async function handleGenerateKey(interaction) {
    if (!isAdmin(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Generate Key')
            .setDescription('❌ **Admin Only**\n\nYou don\'t have permission to generate license keys.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const modal = new ModalBuilder()
        .setCustomId('generate_modal')
        .setTitle('Generate License Key');
    
    const tierInput = new TextInputBuilder()
        .setCustomId('tier')
        .setLabel('Tier (Premium/Basic)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Premium')
        .setRequired(true);
    
    const daysInput = new TextInputBuilder()
        .setCustomId('days')
        .setLabel('Duration (days)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('90')
        .setRequired(true);
    
    const actionRow1 = new ActionRowBuilder().addComponents(tierInput);
    const actionRow2 = new ActionRowBuilder().addComponents(daysInput);
    modal.addComponents(actionRow1, actionRow2);
    
    await interaction.showModal(modal);
}

// Process redeem modal
async function processRedeemModal(interaction) {
    const licenseKey = interaction.fields.getTextInputValue('license_key').toUpperCase();
    
    const license = await db.get('SELECT * FROM licenses WHERE key = ?', licenseKey);
    
    if (!license) {
        const embed = new EmbedBuilder()
            .setTitle('Redeem License')
            .setDescription('❌ **Invalid License Key**\n\nThe key you entered does not exist.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (license.redeemed_by) {
        const embed = new EmbedBuilder()
            .setTitle('Redeem License')
            .setDescription('❌ **Key Already Used**\n\nThis license key has already been redeemed.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (license.expires_at < Date.now()) {
        const embed = new EmbedBuilder()
            .setTitle('Redeem License')
            .setDescription('❌ **Key Expired**\n\nThis license key has expired.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Check if user already has a license
    const existingUser = await db.get('SELECT * FROM users WHERE discord_id = ?', interaction.user.id);
    if (existingUser && existingUser.license_key) {
        const embed = new EmbedBuilder()
            .setTitle('Redeem License')
            .setDescription('❌ **Already Has License**\n\nYou already have an active license. You cannot redeem another key.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Redeem the key
    await db.run(
        'UPDATE licenses SET redeemed_by = ?, redeemed_at = ? WHERE key = ?',
        interaction.user.id, Date.now(), licenseKey
    );
    
    await db.run(
        'INSERT OR REPLACE INTO users (discord_id, license_key, redeemed_at) VALUES (?, ?, ?)',
        interaction.user.id, licenseKey, Date.now()
    );
    
    const embed = new EmbedBuilder()
        .setTitle('Redeem License')
        .setDescription(`✅ **License Redeemed Successfully!**\n\n**Tier:** ${license.tier}\n**Key:** ${licenseKey}\n\nUse the **My Stats** button to view your subscription details.`)
        .setColor(0x00ff00);
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Process generate modal
async function processGenerateModal(interaction) {
    if (!isAdmin(interaction.member)) {
        return;
    }
    
    const tier = interaction.fields.getTextInputValue('tier');
    const days = parseInt(interaction.fields.getTextInputValue('days'));
    
    if (isNaN(days) || days <= 0) {
        const embed = new EmbedBuilder()
            .setTitle('Generate Key')
            .setDescription('❌ **Invalid duration**\n\nPlease enter a valid number of days.')
            .setColor(0xff0000);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const licenseKey = generateLicenseKey();
    const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
    
    await db.run(
        'INSERT INTO licenses (key, tier, expires_at) VALUES (?, ?, ?)',
        licenseKey, tier, expiresAt
    );
    
    const embed = new EmbedBuilder()
        .setTitle('Generate Key')
        .setDescription(`✅ **License Key Generated**\n\n**Key:** \`${licenseKey}\`\n**Tier:** ${tier}\n**Duration:** ${days} days\n**Expires:** <t:${Math.floor(expiresAt / 1000)}:R>`)
        .setColor(0x00ff00);
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Bind HWID (you can call this from your app/loader)
async function bindHWID(licenseKey, hwid) {
    const license = await db.get('SELECT * FROM licenses WHERE key = ?', licenseKey);
    
    if (!license || !license.redeemed_by) {
        return { success: false, error: 'Invalid license' };
    }
    
    const user = await db.get('SELECT * FROM users WHERE discord_id = ?', license.redeemed_by);
    
    if (user.hwid && user.hwid !== hashHWID(hwid)) {
        return { success: false, error: 'HWID mismatch. Please reset HWID from Discord.' };
    }
    
    await db.run('UPDATE users SET hwid = ? WHERE discord_id = ?', hashHWID(hwid), license.redeemed_by);
    
    return { success: true, tier: license.tier, expiresAt: license.expires_at };
}

// Client ready event
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await setupDatabase();
    console.log('Database ready');
    
    // Optional: Send license panel to a specific channel
    // const channel = await client.channels.fetch('YOUR_CHANNEL_ID');
    // if (channel) {
    //     await channel.send({
    //         embeds: [createLicensePanel()],
    //         components: [createButtons()]
    //     });
    // }
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        switch (interaction.customId) {
            case 'redeem_key':
                await handleRedeemKey(interaction);
                break;
            case 'my_stats':
                await handleMyStats(interaction);
                break;
            case 'reset_hwid':
                await handleResetHwid(interaction);
                break;
            case 'generate_key':
                await handleGenerateKey(interaction);
                break;
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'redeem_modal') {
            await processRedeemModal(interaction);
        } else if (interaction.customId === 'generate_modal') {
            await processGenerateModal(interaction);
        }
    }
});

// Login
client.login(process.env.DISCORD_BOT_TOKEN);
