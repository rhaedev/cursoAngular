'use strict'

var User = require('../models/user');
var bcrypt = require('bcrypt-nodejs');
var jwt = require('../services/jwt');
var mongoosePaginate = require('mongoose-pagination');
var fs = require('fs');
var path = require('path');
var Follow = require('../models/follow');
var Publication = require('../models/publication');

function home(req, res) {
	res.status(200).send({
		message: 'Hola mundo desde el servidor de node.js'
	});
}


function pruebas(req, res) {
	console.log(req.body)
	res.status(200).send({
		message: 'Accion de pruebas en el servidor de node.js'
	});
}

//Registro de Usuario
function saveUser(req, res) {
	var params = req.body;
	var user = new User();

	console.log(params.name);

	if (params.name && params.surname && params.nick && params.email && params.password) {
		user.name = params.name;
		user.surname = params.surname;
		user.nick = params.nick;
		user.email = params.email;
		user.role = "ROLE_USER";
		user.img = null;

		// Controlar usuarios duplicados
		User.find({$or: [
			{email: user.email.toLowerCase()},
			{nick: user.nick.toLowerCase()}
		]}).exec((err, users) => {
			if (err) return res.status(500).send({message: "Error en la peticion de Usuarios."});
			if (users && users.length >= 1){
				return res.status(200).send({message: "El Usuario que intenta registrar ya existe."})
			} else {				
				// Cifra y guarda los datos
				bcrypt.hash(params.password, null, null, (err, hash) => {
					user.password = hash;

					user.save((err, userStored) => {
						if (err) return res.status(500).send({message: "Error al guardar Usuario."});
						if (userStored) {
							res.status(200).send({user: userStored});
						} else {
							res.status(404).send({message: "No se ha registrado el Usuario"});
						}
					});

				});
			}
		})


	} else {
		res.status(200).send({
			message: "Envia todos los campos necesarios"
		});
	}
}

//Login de Usuario
function loginUser (req, res) {
	var params = req.body;

	var email = params.email;
	var password = params.password;

	User.findOne({email: email}, (err, user) =>{
		if (err) return res.status(500).send({message: "Error en la peticion."});
		if (user) {
			bcrypt.compare(password, user.password, (err, check) => {
				if (check) {
					
					if (params.gettoken) {
						//devolver token
						return res.status(200).send({
							token: jwt.createToken(user)
						})
					} else {
						//devolver datos de usuario
						user.password = undefined;
						return res.status(200).send({user});
					}

				}else{
					return res.status(404).send({message: 'El usuario no se ha podido identificar'});
				}
			});
		}else{
			return res.status(404).send({message: '¡El usuario no se ha podido identificar!'})
		}
	});
}

//Conseguir datos de un usuario
function getUser(req, res){
	var userId = req.params.id;

	User.findById(userId, (err, user) => {

		if(err) return res.status(500).send({message: 'Error en la petición'});
		if(!user) return res.status(404).send({message: 'El usuario no existe'});

		followThisUser(req.user.sub, userId).then((value) => {
			return res.status(200).send({user, 
										 following: value.following,
										 followed: value.followed});
		});
		
	});
}

async function followThisUser(identity_user_id, user_id) {
	try{
		var following = await Follow.findOne({user:identity_user_id, followed: user_id}).exec().then((following) => {
				console.log(following);
				return following;
			}).catch((err) => {
				return handleError(err);
			});

		var followed = await Follow.findOne({user:user_id, followed: identity_user_id}).exec().then((followed) => {
				console.log(followed);
				return followed;
			}).catch((err) => {
				return handleError(err);
			});

		return {
			following: following,
			followed: followed
		}
	}catch (e){
		console.log(e)
	}
}

//Devolver un listado de usuarios paginado
function getUsers(req, res){
	var identity_user_id = req.user.sub;
	var page = 1;

	if(req.params.page){
		page = req.params.page;
	}

	var itemsPerPage = 5;

	User.find().sort('_id').paginate(page, itemsPerPage, (err, users, total) => {

		if(err) return res.status(500).send({message: 'Error en la petición'});
		if(!users) return res.status(404).send({message: 'No hay usuarios disponibles.'});

		followUserIds(identity_user_id).then((value) => {
			return res.status(200).send({
				users,
				users_following: value.following,
				users_follow_me: value.followed,
				total,
				page: Math.ceil(total/itemsPerPage)
			});
		});		
	});
}

async function followUserIds (user_id) {
	try{
		var following = await Follow.find({'user': user_id}).select({'_id':0, '__V':0, 'user':0}).exec().then((follows) => {
			var follows_clean = [];

			follows.forEach((follow) => {
				follows_clean.push(follow.followed);
			});

			console.log(follows_clean);

			return follows_clean; 
		}).catch(err => handleError(err));

		var followed= await Follow.find({'followed': user_id}).select({'_id':0, '__V':0, 'followed':0}).exec().then((follows) => {
			var follows_clean = [];

			follows.forEach((follow) => {
				follows_clean.push(follow.user);
			});

			return follows_clean; 
		}).catch(err => handleError(err));

		return {
			following: following,
			followed: followed
		}

	}catch(e){
		console.log(e);
	}	
}

function getCounters(req, res) {
	var userId = req.user.sub;

	if (req.params.id) {
		userId = req.params.id;
	}
	
	getCountFollow(userId).then((value) => {
		return res.status(200).send(value);
	});
}

async function getCountFollow (user_id) {
	var following = await Follow.count({user: user_id}).exec().then(count => count).catch(err => handleError(err));

	var followed = await Follow.count({followed: user_id}).exec().then(count => count).catch(err => handleError(err));

	var publications = await Publication.count({user: user_id}).exec().then(count => count).catch(err => handleError(err));

	return{
		following: following,
		followed: followed,
		publications: publications
	}
}

// Edicion de datos de usuario
function updateUser(req, res) {
	var userId = req.params.id;
	var update = req.body;

	//borrar la propiedad password
	delete update.password;

	if(userId != req.user.sub){
		return res.status(500).send({message: 'No tienes permiso para actualizar los datos del usuario.'});
	}

	User.findByIdAndUpdate(userId, update, {new:true},  (err, userUpdated) => {

		if(err) return res.status(500).send({message: 'Error en la petición.'});
		if(!userUpdated) return res.status(404).send({message: 'No se ha podido actualizar el usuario.'});

		return res.status(200).send({user: userUpdated});
	});
}

function uploadImage (req, res) {
	var userId = req.params.id;

	if (req.files) {
		//Recoge el path del Archivo
		var file_path = req.files.image.path;
		//Cortamos por cada \ la path
		var file_split = file_path.split('\\');
		//Seleccionamos la 3 posicion, que es la de la imagen
		var file_name = file_split[2];
		//Cortamos el nombre de la imagen por el punto, para saber su extension.
		var ext_split = file_name.split('\.');
		//Ya sabemos su extencion
		var file_ext = ext_split[1];
		file_ext = file_ext.toLowerCase();
		console.log(file_ext);

		if (userId != req.user.sub){			
			return removeFilesOfUploads(res, file_path, 'No tienes permiso para actualizar los datos del usuario.');
		} 

		console.log(file_name);

		if (file_ext == 'png' || file_ext == 'jpg' || file_ext == 'jpeg' || file_ext == 'gif'){
			//Actualizar documento de usuario logueado
			User.findByIdAndUpdate(userId, {img: file_name}, {new: true}, (err, userUpdated) => {

				if(err) return res.status(500).send({message: 'Error en la petición.'});

				if(!userUpdated) return res.status(404).send({message: 'No se ha podido actualizar el usuario.'});

				return res.status(200).send({user: userUpdated});
			});

		} else {
			return removeFilesOfUploads(res, file_path, 'Extensión no valida');
		}

	} else {
		return res.status(200).send({message: 'No se han subido imagenes.'});
	}
}

function removeFilesOfUploads(res, file_path, message) {
	fs.unlink(file_path, (err) => {
		return res.status(200).send({message: message});
	});
}

function getImageFile(req, res) {
	var image_file = req.params.imageFile;
	var path_file = './uploads/users/' + image_file;

	fs.exists(path_file, (exists) =>{
		if (exists) {
			res.sendFile(path.resolve(path_file));
		} else {
			res.status(200).send({message: 'No existe la imagen.'});
		}
	})
}

module.exports = {
	home,
	pruebas, 
	saveUser,
	loginUser,
	getUser,
	getUsers,
	getCounters,
	updateUser,
	uploadImage,
	getImageFile
}