const router = require('express').Router();
const path = require('path');
const rp = require('request-promise');
const verifyUserAjax = require('../middleware/verify-user.js')({ajax: true});
const verifyBot = require('../middleware/verify-bot.js');
const StickerPack = require('./models/sticker-pack-model.js');
const Guild = require('./models/guild-model.js');
const User = require('./models/user-model.js');
const util = require('./utilities/utilities.js');
const imageToCdn = require('./utilities/image-to-cdn.js');
const deleteCdnImage = require('./utilities/delete-cdn-image.js');
const emojis = require('./utilities/emojis.json');
const multer = require('multer');

let storage = multer.memoryStorage();
let upload = multer({
	storage: storage,
	limits: {fileSize: 5 * 1024 * 1024} //5MB max image upload
});
let handleMulterError = function(err, req, res, next){
	if(err)	res.status(400).send(err.message)
	else next();
}

const removedFields = {
	'_id': false,
	'__v': false,
	'stickers._id': false
}

///////
//GET//
///////

router.get('/', async (req, res) =>{

	let packsPerPage = 8;

	//Page #
	let requestedPage = parseInt(req.query.page);
	let skipAmount = 0;

	if(!isNaN(requestedPage) && requestedPage !== 0){	
		skipAmount = (parseInt(req.query.page) - 1) * packsPerPage;
	}	

	//Sort Type
	let sortType;

	if(req.query.sort === 'popular') sortType = '-subscribers';
	else if(req.query.sort === 'oldest') sortType = 'createdAt';
	else sortType = '-createdAt';

	//Search
	let search = {};

	if(req.query.search){
		let s = decodeURIComponent(req.query.search).trim();
		let regex = new RegExp(s, 'i');
		search.$or = [{name: regex}, {key: regex}];
	}

	try{

		const packs = await StickerPack.find(search, removedFields).sort(sortType).skip(skipAmount).limit(packsPerPage);
		return res.send(packs);

	}catch(err){
		console.log(err.message);
		return res.status(500).send('Internal server error');	
	}	

});

//GET Sticker pack by key 
router.get('/:key', async (req, res) => {

	try{
		const pack = await StickerPack.findOne({key: req.params.key}, removedFields);
		if(!pack) return res.status(404).send('Sticker Pack not found');
		res.json(pack);
	}catch(err){
		res.status(500).send('Internal server error');
	}	

});

//GET Sticker Pack stickers
router.get('/:key/stickers', async (req, res) => {

	try{
		const pack = await StickerPack.findOne({key: req.params.key}, removedFields);
		if(!pack) return res.status(404).send('Sticker Pack not found');
		res.json(pack.stickers);
	}catch(err){
		res.status(500).send('Internal server error');
	}	

});

//GET a specific sticker from a Sticker Pack 
router.get('/:key/stickers/:stickername', async (req, res) => {

	try{
		const pack = await StickerPack.findOne({key: req.params.key}, removedFields);
		if(!pack) return res.status(404).send('Sticker Pack not found');
		const sticker = pack.stickers.find(s => s.name === req.params.stickername);
		if(!sticker) return res.status(404).send('Sticker Pack does not contain a sticker with that name');
		res.json(sticker);
	}catch(err){
		res.status(500).send('Internal server error');
	}	

});

////////
//POST//
////////

//POST new sticker pack
router.post('/', /*verifyUserAjax,*/ async (req, res) => {

	if(!req.body.name || !req.body.key) return res.status(400).send('Invalid body data');
	if(!req.body.key.match(/^[a-z0-9]+$/g)) return res.status(400).send('Sticker Pack key must contain lowercase letters and numbers only');
	if(req.body.key.length > 6) return res.status(400).send('Sticker Pack key cannot be longer than 6 characters');
	if(req.body.name.length > 60) return res.status(400).send('Sticker Pack name cannot be longer than 60 characters');
	//if(!res.locals.userId) return res.status(401).send('Unauthorized');

	//Check if Sticker Pack key is already used
	const keyAlreadyUsed = await StickerPack.findOne({key: req.body.key});
	if(keyAlreadyUsed) return res.status(400).send('There is already a Sticker Pack with that key');	

	//Create Sticker Pack
	let data = Object.assign({}, req.body);
	data.creatorId = 'test-id';//res.locals.userId;
	
	try{
		await new StickerPack(data).save();
		const pack = await StickerPack.findOne({key: req.body.key}, removedFields);
		res.status(201).json(pack);
	}catch(err){
		console.error(err);
		res.status(500).send('Internal server error');
	}

});

//POST new sticker to sticker pack
router.post('/:key/stickers', verifyUserAjax, upload.single('sticker'), handleMulterError, async (req, res) => {

	if(!req.body.name || (!req.body.url && !req.file)) return res.status(400).send('Invalid body data');
	if(!req.body.name.match(/^:?-?[a-z0-9]+:?$/g)) return res.status(400).send('Sticker name must contain lowercase letters and numbers only');
	if(req.body.name.length > 20) return res.status(400).send('Sticker name cannot be longer than 20 characters');	
	if(!res.locals.userId) return res.status(401).send('Unauthorized');

	let sticker = {
		image: (req.file) ? req.file.buffer : req.body.url,
		name: req.body.name.toLowerCase().replace(/(:|-)/g, ''),
		createdVia: (req.file) ? 'website' : 'discord',
		groupId: req.params.key,
		creatorId: res.locals.userId
	}

	let imageIsLocal = (req.file) ? true : false;

	try{

		let pack = await StickerPack.findOne({key: req.params.key});
		if(!pack) return res.status(404).send('Sticker Pack not found');
		if(res.locals.userId != pack.creatorId) return res.status(401).send('Unauthorized');
		if(pack.stickers.map(s => s.name).includes(sticker.name)) return res.status(400).send('Sticker Pack already has a sticker with that name');
		if(pack.stickers.length >= 400) return res.status(403).send('Sticker Pack has reached maximum amount of stickers (400)');

		sticker.url = await imageToCdn(sticker.image, `${pack.key}-${(new Date()).getTime()}-${sticker.name}`);

		pack.stickers.unshift(sticker);	
		pack = await pack.save();
		
		sticker = pack.stickers.find(s => s.name === sticker.name);
		return res.status(201).json(util.removeProps(sticker._doc, ['_id']));

	}catch(err){

		if(err.message.includes('Unauthorized')) return res.status(401).send('Unauthorized');
		console.error(err);
		res.status(500).send('Internal server error');

	}

});

//Increment `uses` property on a sticker
router.post('/:key/stickers/:stickername/uses', /*verifyBot,*/ async (req, res) => {

	let pack = await StickerPack.findOne({key: req.params.key});
	if(!pack) return res.status(404).send('Sticker Pack not found');
	let sticker = pack._doc.stickers.find(s => s.name === req.params.stickername);
	if(!sticker) return res.status(404).send('Sticker Pack does not have a sticker with that name');

	sticker.uses += 1;
	pack.save();

	return res.json(util.removeProps(sticker._doc, ['_id']));

});

/////////
//PATCH//
/////////

router.patch('/:key/subscribers', verifyUserAjax, async (req, res) => {

	let pack = await StickerPack.findOne({key: req.params.key});

	if(!pack) return res.status(404).send('Sticker Pack not found');
	if(
		!req.body.subscriptions ||
	  !util.objArrHasProps(req.body.subscriptions, ['type', 'id', 'subscribed'])
	){
		return res.status(400).send('Invalid body data');
	}

	//Init response data
	let response_data = JSON.parse(JSON.stringify(req.body.subscriptions));

	try{

		let pack_key = req.params.key;
		let guild_update_requests = req.body.subscriptions.filter(s => s.type === 'guild');
		let user_update_requests = req.body.subscriptions.filter(s => s.type === 'user');

		let guilds = await Promise.all(guild_update_requests.map(s => Guild.findOne({id: s.id})));	
		let users = await Promise.all(user_update_requests.map(s => User.findOne({id: s.id})));	

		//Init response data success property
		response_data.forEach(update_req => update_req.successfully_updated = false);

		guilds.forEach(guild => {
			//If guild doesn't exist, break loop early
			if(!guild) return;
			//If user doesn't have permission break loop early
			if(!util.userIsStickerManager(guild, req, res) && !util.userIsGuildManager(guild, req, res)){	
				return;
			}

			let subscribed = guild_update_requests.find(s => s.id === guild.id).subscribed;
			//Remove pack from guilds that need it removed
			if(guild.stickerPacks.includes(pack_key) && !subscribed){
				const pack_key_index = guild.stickerPacks.indexOf(pack_key);
				guild.stickerPacks.splice(pack_key_index, 1);
				pack.subscribers -= 1;
				if(pack.subscribers < 0) pack.subscribers = 0;
			}
			//Add pack to guilds that need it added
			if(!guild.stickerPacks.includes(pack_key) && subscribed){
				guild.stickerPacks.push(pack_key);
				pack.subscribers += 1;
			}
			guild.save();

			//Update response data
			response_data.find(update_req => update_req.id === guild.id).successfully_updated = true;
		});

		users.forEach(user => {	
			//If user doesn't exist, break loop early
			if(!user) return;
			//If request user id doesn't match user id, break early for lack of permission 
			if(user.id != res.locals.userId){
				return;
			}

			let subscribed = user_update_requests.find(s => s.id === user.id).subscribed;
			//Remove pack from users that need it removed
			if(user.stickerPacks.includes(pack_key) && !subscribed){
				const pack_key_index = user.stickerPacks.indexOf(pack_key);
				user.stickerPacks.splice(pack_key_index, 1);
				pack.subscribers -= 1;
				if(pack.subscribers < 0) pack.subscribers = 0;
			}
			//Add pack to users that need it added
			if(!user.stickerPacks.includes(pack_key) && subscribed){
				user.stickerPacks.push(pack_key);
				pack.subscribers += 1;
			}
			user.save();

			//Update response data
			response_data.find(update_req => update_req.id === user.id).successfully_updated = true;
		});

		await pack.save();

	}catch(err){
		console.error(err);
		return res.status(500).send('Internal server error');
	}

	return res.status(207).send(response_data);

});

//////////
//DELETE//
//////////

//DELETE sticker from sticker pack
router.delete('/:key/stickers/:stickername', verifyUserAjax, async (req, res) => {	

	try{

		let pack = await StickerPack.findOne({key: req.params.key});

		if(!pack) return res.status(404).send('Sticker Pack not found');
		if(res.locals.userId != pack.creatorId) return res.status(401).send('Unauthorized');

		let sticker_names = pack.stickers.map(s => s.name);
		let deletion_request_index = sticker_names.indexOf(req.params.stickername);
		if(deletion_request_index === -1) return res.status(404).send('Sticker Pack does not have a sticker with that name');

		deleteCdnImage(pack.stickers[deletion_request_index].url);
		pack.stickers.splice(deletion_request_index, 1);
		await pack.save();

		return res.send('Successfully deleted sticker');

	}catch(err){

		if(err.message.includes('Unauthorized')) return res.status(401).send('Unauthorized');
		console.error(err);
		res.status(500).send('Internal server error');

	}

});

module.exports = router;
