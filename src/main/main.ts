import { app } from "electron";
import squirrelStartup from "electron-squirrel-startup";

if (squirrelStartup) app.quit();
else void import("./index");
