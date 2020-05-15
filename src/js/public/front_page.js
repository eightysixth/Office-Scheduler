const {ipcRenderer} = require("electron")

function promptLogIn(){
    ipcRenderer.send("prompt-login")
}

function hideStatus(){
    alertItem = document.getElementById("login-alert")
    alertItem.classList.add("hidden")
}

function notifyLoginStatus(success,message){
    alertItem = document.getElementById("login-alert")
    alertItem.className = "alert"
    alertItem.innerHTML = message;

    if (!success){
        alertItem.classList.add("alert-danger")
    } else {
        alertItem.classList.add("alert-success")
    }
}

function logout(){
    hideStatus();
    ipcRenderer.send("wipe-session-data");
    ipcRenderer.send("logout")
}

function getSchedule(){
    ipcRenderer.send("show-schedule");
}

//--- EVENTS ----//
ipcRenderer.on("logged-in", (event,arg) => {
    // Arg will be user's data
    notifyLoginStatus(true, '<img id="user-img"class="img-circle" width="32" height="32" src="'+arg.img+'">'+
                            " Logged in <b>" + arg.name + "</b>")
    ipcRenderer.send("wipe-session-data")
})

ipcRenderer.on("login-failed", (event,arg) => {
    console.log("loginfailed");
    if (arg.errCode != null){
        notifyLoginStatus(false, arg.msg)
        console.log(arg.msg)
    }
    ipcRenderer.send("wipe-session-data")
})

// Get public config items and set page to display it.
ipcRenderer.send("get-public-config")
ipcRenderer.on("get-public-config", (event, arg) => {
    // Set the center Header's text
    centerHeader = document.getElementById("center-header01")
    centerHeader.innerHTML = arg.strings.center_header
    // Set the page title
    document.title = arg.strings.window_title;
    // Set the domain settings tag line
    sign_in_tagline = document.getElementById("signin-tagline-lbl")
    sign_in_tagline.innerHTML = 'Sign in using your <b>'+arg.strings.domain+'</b> account.'
})