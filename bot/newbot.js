/*********************/
/*******GLOBALS*******/
/*********************/

//Node Modules
const Discord = require('discord.js');
const mongoose = require('mongoose');

//Assets
const util = require('./utility-functions');
const special = require('./special.json');
const replies = require('./replies.js');

//Mongo Models
const Guild = require('../models/guild');
const User = require('../models/user');
const StickerPack = require('../models/sticker-pack');

//Bot/DB/CDN Setup 
mongoose.Promise = global.Promise;
mongoose.connect('mongodb://localhost/test');
const db = mongoose.connection;
const client = new Discord.Client();
db.on('error', err => util.handleError(err));

//Bot commands
const commands = {
	'stickers': require('./commands/stickers.js'),
	'addsticker': require('./commands/addsticker.js'),
	'removesticker': require('./commands/removesticker.js'),
	'setprefix': require('./commands/setprefix.js'),
	'setrole': require('./commands/setrole.js'),
	'help': require('./commands/help.js')
}

/********************/
/*****BOT EVENTS*****/
/********************/

//Start bot
client.on('ready', () => {
  console.log('I am ready!');
});

//When message is sent
client.on('message', message => {

	let messageWords = message.content.toLowerCase().trim().split(' ');
	let firstWord = messageWords[0];
	let messageHasCommand = Object.keys(commands).some(command=>{
		return firstWord.endsWith(command);
	});

	//DM Messages
	if(message.channel.type == 'dm'){

		//Stop immediately if message was sent by this bot and not user
		if(message.author.id == client.user.id) return false;

		//Give help if message doesn't contain a valid command
		if(!messageHasCommand){
			commands.help(message);
			return false;
		}

		User.findOneAndUpdate(
			{id: message.author.id},
			{
				id: message.author.id,
				username: message.author.username,
				avatarURL: message.author.avatarURL
			},
			{upsert: true,	new: true, setDefaultsOnInsert: true}
		)
		.then(dbUser => {

			//Commands
			if(firstWord.endsWith('stickers')) commands.stickers(message, dbUser);

			if(firstWord.endsWith('addsticker')) commands.addsticker(message, dbUser);

			if(firstWord.endsWith('removesticker')) commands.removesticker(message, dbUser);

			if(firstWord.endsWith('help')) commands.help(message, dbUser);

			//else commands.help(message, dbUser)

		}).catch(err => util.handleError(err, message));

	}

	//Guild Messages
	else if(message.channel.type == 'text'){

		//Don't proceed if message doesn't contain command
		if(!messageHasCommand) return false;

		Guild.findOneAndUpdate(
			{id: message.channel.guild.id},
			{id: message.channel.guild.id},
			{upsert: true,	new: true, setDefaultsOnInsert: true}
		)
		.then(dbGuild => {

			let prefix = dbGuild.prefix;

			//Don't proceed if message doesn't contain begin with prefix
			if(!firstWord.startsWith(prefix)) return false;


			//Commands
			if(firstWord.slice(prefix.length) == 'stickers'){
				commands.stickers(message, dbGuild);
			}

			if(firstWord.slice(prefix.length) == 'help'){
				commands.help(message, dbGuild);
			}			

			else if(util.msgHasRole(message, dbGuild.managerRole)){

				if(firstWord.slice(prefix.length) == 'addsticker'){
					commands.addsticker(message, dbGuild);
				}

				if(firstWord.slice(prefix.length) == 'removesticker'){
					commands.removesticker(message, dbGuild);
				}

				if(firstWord.slice(prefix.length) == 'setrole'){
					commands.setrole(message, dbGuild);
				}

				if(firstWord.slice(prefix.length) == 'setprefix'){
					commands.setprefix(message, dbGuild);
				}

			}else{
				replies.use(message, 'insufficientPermission', {'%%ROLE%%': dbGuild.managerRole});
				return false
			}

		}).catch(err => util.handleError(err));

	}


});

client.login(special.token);