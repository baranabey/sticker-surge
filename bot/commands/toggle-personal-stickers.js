const rp = require('request-promise');
const covert = require('../../covert.js');

module.exports = async function(message, bot_auth, prefix){

	let guild = message.channel.guild;

	const res = await rp({uri: `${covert.app_url}/api/guilds/${guild.id}`, json: true});
	const personal_stickers_currently_allowed = res.personalStickersAllowed;

	try {

		await rp({
			method: 'PATCH',
			uri: `${covert.app_url}/api/guilds/${guild.id}`,
			body: {
				personalStickersAllowed: !personal_stickers_currently_allowed
			},
			headers: {
				Authorization: bot_auth,
				'Author-Id': message.author.id
			},
			json: true
		});

		message.channel.send(!personal_stickers_currently_allowed ?
			"Personal stickers are now **allowed** on this server." :
			"Personal stickers are now **disallowed** on this server."
		);	

	}catch(err) {

		if(err.message.includes('Unauthorized')) {
			message.channel.send(`You must have permission to manage the server in order to use this command.`);
		}else {
			message.channel.send('An unknown error occured.');
			console.log(err);
		}

	}

}
