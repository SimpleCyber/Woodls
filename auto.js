const robot = require("robotjs");

console.log("Starting in 5 seconds...");
setTimeout(() => {
    robot.typeString("Hello from robotjs auto typing!");
}, 5000);


