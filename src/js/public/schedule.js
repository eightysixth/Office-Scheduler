const {ipcRenderer} = require("electron")

document.addEventListener('DOMContentLoaded', function() {
    var calendarEl = document.getElementById('calendar');
    ipcRenderer.send("get-calendar-config");
    ipcRenderer.on('get-calendar-config', (event, arg) => {
        cal_config = arg.calendar     
        var calendar = new FullCalendar.Calendar(calendarEl, {
            plugins: [ 'interaction', 'timeGrid','dayGrid', 'list', 'googleCalendar' ],
            header: {
              left: '',
              center: 'title', 
              right: ''
            },
            height: 450,
            defaultView: 'timeGridFiveDay',
            views:{
                timeGridFiveDay: cal_config.calendar_default_view
            },
      
            displayEventTime: false, // don't show the time column in list view
      
            googleCalendarApiKey: cal_config.google_calendar_api_key,
      
            events: cal_config.google_calendar_schedule_id,
          
            eventClick: function(arg){
                arg.jsEvent.preventDefault();
            },
            loading: function(bool) {
              document.getElementById('loading').style.display =
                bool ? 'block' : 'none';
            }
      
          });
      
          calendar.render();
    })
});