const mongoose = require('mongoose');
const util = require('./utility-functions.js');

//Mongo Models
const Guild = require('../../models/guild.js');
const User = require('../../models/user.js');
const StickerPack = require('../../models/sticker-pack.js');

//Add value to beginning of array, array max length is 3, only one of each value
function updateRecentStickers(array, value){
	if(array.includes(value)){
		let index = array.indexOf(value);
		array.splice(index, 1);
	}
	array.unshift(value);
	return array.slice(0,3);
}

module.exports = function(message){

	let command = message.content.toLowerCase().replace(/:/g, '');	
	let stickers = [];
	let guild = null;

	let documentArray = [
		User.findOneAndUpdate(
			{id: message.author.id},
			{
				id: message.author.id,
				username: message.author.username,
				avatarURL: message.author.avatarURL
			},
			{upsert: true,	new: true, setDefaultsOnInsert: true}
		),
	];
	if(message.channel.type == 'text'){
		documentArray.push(
			Guild.findOneAndUpdate(
				{id: message.channel.guild.id},
				{id: message.channel.guild.id},
				{upsert: true,	new: true, setDefaultsOnInsert: true}
			)
		);
	}

	Promise.all(documentArray)
	.then(docs => {

		let user = docs[0];
		guild = (docs[1]) ? docs[1] : null;

		//Push custom stickers into stickers array
		user.customStickers.forEach(sticker=>{
			sticker.name = '-'+sticker.name;
		});
		stickers = user.customStickers;
		if(guild) stickers = stickers.concat(guild.customStickers);

		//Find sticker packs used by the user & guild
		let stickerPackKeys = user.stickerPacks;
		if(guild) stickerPackKeys = stickerPackKeys.concat(guild.stickerPacks);

		//Remove duplicates from sticker pack keys array
		return stickerPackKeys.filter(function(elem, index, arr) {
			return index == arr.indexOf(elem);
		})

	})
	.then(stickerPackKeys => {
		return StickerPack.find({'key': {$in: stickerPackKeys} });
	})
	.then(stickerPacks => {
		
		stickerPacks.forEach(pack=>{
			pack.stickers.forEach(sticker=>{
				sticker.name = pack.key + '-'+sticker.name;
			});	
			stickers = stickers.concat(pack.stickers);
		});

		//if message matches sticker
		if( stickers.map(s=>s.name).includes(command) ){

			//Send sticker
			let index = stickers.map(s=>s.name).indexOf(command);	
			message.channel.sendFile(
				stickers[index].url,
				`${command}.png`,
				`**${util.authorDisplayName(message)}:**`
			);

			//Delete message that was sent to trigger response, and save guild recentStickers
			if(message.channel.type == 'text'){

				if(command[0] != '-'){
					guild.recentStickers = updateRecentStickers(guild.recentStickers, command);
					guild.save();
				}

				message.delete()
				.catch(err=>{
					console.log(`Unable to delete message on guild: ${guild.id}`);
				});
			}

		}

	}).catch(err => util.handleError(err, message));

}