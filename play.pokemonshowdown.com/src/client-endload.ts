import { Config, PS, type RoomID } from "./client-main";
import { Dex } from "./battle-dex";

import { BattlePanel } from "./panel-battle";

PS.libsLoaded.loaded();
if (Config.tmt2Local && /^#battle-uploaded-[0-9]+$/.test(location.hash)) {
	try {
		BattlePanel.loadLocalReplay(JSON.parse(sessionStorage.getItem('tmt2-native-replay') || 'null'),
			location.hash.slice(1) as RoomID);
	} catch (err) { PS.alert(String(err)); }
}
void Dex.loadTextData().then(() => PS.updateTranslatedText());
