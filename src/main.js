const {app, BrowserWindow, Menu, Tray, session, ipcMain} = require("electron")
const path = require("path")
const {OAuth2Client, auth} = require('google-auth-library')
const querystring = require('querystring')
const http = require("http")
const fs = require("fs")
const url = require("url")
const {google} = require("googleapis")
const DataStore = require("nedb")


let mainWindow, scheduleWindow, server, authWindow, loginsDB, config, calendarAPI, cal_client;
var loggedInUsers = [];

config = loadJsonFile(path.join(__dirname, "config.json"))

// Secure lock to run only one instance of this app.
const gotTheLock = app.requestSingleInstanceLock();
// Storing data on local computer
const appData = path.join(app.getPath('appData') , '/'+config.strings.app_name)
// Create our app's folder if not exists
if (!fs.existsSync(appData)){
    fs.mkdirSync(appData);
}
const loginDBFile = path.join(appData, "logins.db")
if (!fs.existsSync(loginDBFile)){
    console.log("File doesn't exist")
    fs.writeFileSync(loginDBFile)
}
loginsDB = new DataStore({filename: loginDBFile, autoload: true})
loginsDB.insert({createdAt: Date(), type: "app-start"})

function isDev(){
    return config.env.mode == "DEV";
}

function closeChildWindows(parentWindow){
    parentWindow.getChildWindows().forEach((child) => {
        child.close();
    })
}

function clearStorage(arg){
    if (!isDev()){ 
        session.defaultSession.clearStorageData();
    } else  {// DEV mode, don't clear
        // session.defaultSession.clearStorageData();
        console.log("[main.js]: Cleared session data!")
    }
}

// === UTIL === //
//--LOAD A JSON FILE --//
function loadJsonFile(filePath){
    var fs = require("fs")
    var content = fs.readFileSync(filePath);
    return JSON.parse(content)
}
// === AUTH WINDOW === //
function openAuthWindow(authorizeURL, oAuth2Client){
    if (authWindow == null){
        authWindow = new BrowserWindow({
            width: 600,
            height: 800,
            autoHideMenuBar: true,
            webPreferences:{
                nodeIntegration: false
            },
            frame: true,
            parent: mainWindow,
        });
        authWindow.setMenu(null)
        authWindow.loadURL(authorizeURL)
        authWindow.on('closed', ()=>{authWindow = null})
        authWindow.on('close',()=>{
            if (server != null){
                server.close();
                server = null;
            }
        })
    }
    // authWindow.webContents.openDevTools()    
    console.log(oAuth2Client)   
}

// === CALENDAR SERVICE ACCOUNT ===//
// Use service account credentials to authenticate and take actions on google calendar
// Token.json is stored in appdata directory
try {
    var service_account_keys = config.service_account
    const SCOPES = "https://www.googleapis.com/auth/calendar.events"

    cal_client = auth.fromJSON(service_account_keys)
    cal_client.scopes = ["https://www.googleapis.com/auth/calendar"]
    calendarAPI = google.calendar({version:"v3", auth:cal_client});
    const calendarID = config.calendar.google_events_calendar_id

    metadata_cal = calendarAPI.calendars.get({calendarId: calendarID}, function(err, resp){
        if (err){
            console.log(err)
        } else {
            console.log("Successful cal fetch")
        }
    })

} catch (error) {
    console.log(error)
}


// === OAUTH === //
//Start by acquiring a pre-authenticated oAuth2 client.
async function authorizeClient(){
    try     {
        const oAuth2Client = await getAuthenticatedClient();
        return oAuth2Client;
    } catch (e){
        console.log(e)
    }
}
  

function closeAuthWindow(){
    if (authWindow){
        authWindow.close();
        authWindow = null;
    }
}

// Send login events to google calendar as specified in config.calendar.events..cal
function logCalendarEvent(user){
    startTime = new Date()

    endTime = new Date(startTime.toISOString())
    endTime.setHours(endTime.getHours() + 1)
    endTime.setMilliseconds(0)

    var event = {
        'summary': user.name,
        'description': 'Login: ' + user.email + ' ' + new Date().toLocaleString(),
        'start': {
            'dateTime': startTime,
            'timeZone': 'America/Edmonton'
        },
        'end':{
            'dateTime': endTime,
            'timeZone': 'America/Edmonton'
        }
    }

    calendarAPI.events.insert({
        'calendarId': config.calendar.google_events_calendar_id,
        'resource': event,
        'auth': cal_client
    }, function(err, resp){
        if (err){   
            console.log("Failed to push to gcal", err)
        } else {
            loginsDB.insert({createdAt: new Date(), type: "gcal-push", email: user.email})
        }
    })
}

function getAuthenticatedClient(){
    return new Promise((resolve, reject)=>{
        // oAuth client to authorize the api call
        const oAuth2Client = new OAuth2Client({
            clientId: config.oauth_config.clientId,
            clientSecret: config.oauth_config.clientSecret,
            redirectUri: config.oauth_config.redirectUri,
        });

        // Generate the url that will be used
        const authorizeURL = oAuth2Client.generateAuthUrl({
            prompt: 'select_account',
            access_type: config.oauth_config.access_type,
            scope: config.oauth_config.scope,
            hd: config.oauth_config.hd,
        });

        // Open http server to accept oauth callback
        server = http.createServer(async(req, res) => {
            if (req.url.indexOf('/oauth2callback') > -1){
                // accquire code from querystring, close the webserver
                const qs = querystring.parse(url.parse(req.url).query)
                server.close();
                server = null;
                closeAuthWindow()

                const r = await oAuth2Client.getToken(qs.code)
                // Set credentials on oAuth2Client
                oAuth2Client.setCredentials(r.tokens)
                
                // Everything is done. No need for server to stay up
                resolve(oAuth2Client)
            }
        }).listen(3000, ()=>{
            openAuthWindow(authorizeURL)
        })

    })
}


// === EVENTS === //
// IPC Events
ipcMain.on("wipe-session-data", (event, arg) => {
    clearStorage(arg)
})
ipcMain.on("logout", (event, arg) => {
    loggedInUsers = []
})

ipcMain.on("get-public-config", (event, arg) => {
    public_config = {strings : config.strings,
        res : config.res,
        calendar : config.calendar,}
    event.sender.send("get-public-config", public_config )
})

// Create a new window to display calendar.
ipcMain.on("show-schedule", (event, arg) => {
    if (scheduleWindow == null){
        // Create new window
        scheduleWindow = new BrowserWindow({
            title: "Schedule",
            width: 950,
            height: 575,
            frame: true, resizable: false, 
            icon: path.join(__dirname, config.res.icon_path),
            autoHideMenuBar: true,
            parent: mainWindow,
            webPreferences:{
                nodeIntegration: true,
                devTools: false
            }
        })
        scheduleWindow.loadFile(path.join(__dirname,"html/schedule.html"))
        scheduleWindow.on("close", (event)=>{
            scheduleWindow = null;
        })
    }
})
ipcMain.on("get-calendar-config", (event, arg) => {
    event.sender.send("get-calendar-config", {calendar: config.calendar, isAdmin: true})
})

ipcMain.on("prompt-login", (event, arg)=>{
    if (authWindow != null){
        authWindow.focus()
        return;
    } else {
        authorizeClient().then((oAuth2Client)=>{
            const url = config.oauth_config.user_info_url;
            const res = oAuth2Client.request({url})

            res.then((result) => {
                const user = result.data;                  
                // If domain lock (user can only login from "hd" -one domain) then return invalid user.
                if (user.hd != config.oauth_config.hd && config.oauth_config.domain_lock == true){
                    var failedMsg = "Login failed. Please use your" + config.oauth_config.hd + " email";
                    event.sender.send("login-failed", {errCode: "invalid-email", msg: failedMsg});
                    loginDB.insert({createdAt: Date(), type: "login-failed", email: user.email})
                    return;
                }
                // Assume successful login.
                event.sender.send("logged-in", {email: user.email, name: user.name, img: user.picture})
                // Put in db
                loggedInUsers.push(user)
                loginsDB.insert({createdAt: Date(), type:"login", email: user.email, name: user.name})
                // Send event to google calendar.
                logCalendarEvent(user);

            })
        })
    }
})

//---- ENTRY FUNCTION ----//
function main(){
    const icon_path = path.join(__dirname, config.res.icon_path)
    mainWindow = new BrowserWindow({
        title: config.strings.window_title,
        width: 450,
        height: 500,
        frame: true, resizable:false, 
        backgroundColor: config.strings.window_bkg_colour,
        icon: icon_path,
        autoHideMenuBar: true,
        webPreferences:{
            nodeIntegration: true,
            devTools: false
        }
    })
    // mainWindow.removeMenu()
    mainWindow.on("close", (event) => {
        // Send to taskbar
        if (!app.isQuitting){
            event.preventDefault(); mainWindow.hide(); closeChildWindows(mainWindow)
        } else {
            mainWindow = null; closeChildWindows(mainWindow)
        }
        return false;
    })
    mainWindow.loadFile(path.join(__dirname,"html/main.html"))

    // System Tray
    appIcon = new Tray(icon_path)
    var contextMenu = Menu.buildFromTemplate([
        {   label: "Show App", click: function(){
            mainWindow.show();}
        },
        {  label: "Quit App", click: function(){
                app.isQuitting = true; app.quit()}
        }
    ])
    appIcon.setContextMenu(contextMenu)
    appIcon.on('click', function(){
        mainWindow.show()
    })
    appIcon.setToolTip(config.strings.window_title)
    
    clearStorage();
}

// Only one instance of the app can be running at once. 
if (!gotTheLock){
    app.quit(); return;
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Second instance was launched, focus window.
        if (mainWindow){
            if (mainWindow.isMinimized()){
                win.restore()
            }
            mainWindow.show();
            mainWindow.focus();
        }
    })
}

// -- START -- //
app.on('ready',()=> {
    main();
})