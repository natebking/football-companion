/* Observation lessons are teaching examples, not descriptions of the live play.
 * The module has no DOM, feed, persistence, prediction, or grading side effects.
 * Background: operations.nfl.com/rules-officiating/nfl-football-basics/football-terms
 * and blogs.usafootball.com/blog/7133/implementing-motion-with-rpo-s . */
(function (root) {
  'use strict';

  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }

  var basicLessons = [
    {
      id: 'motion', title: 'Follow the movement',
      watch: 'If someone moves across the formation before the snap, watch how the defense responds.',
      shortWatch: 'If someone moves before the snap, does a defender follow?',
      question: 'What changed when the player moved?',
      explanation: 'Motion gives the offense a new arrangement before the snap. A defender following the moving player can be a clue about coverage, but defenses can switch assignments or disguise their plan.',
      concepts: ['motion', 'receiver', 'snap', 'zone_coverage'],
      choices: [
        { id: 'followed', label: 'One defender followed', response: 'That can suggest a defender is assigned to that player. Watch whether the defender stays with him after the snap; the movement alone does not settle the coverage.' },
        { id: 'shifted', label: 'Several defenders shifted', response: 'The defense may be sharing or changing assignments as the offense moves. Follow one defender after the snap to see whether he follows a player or watches an area.' },
        { id: 'none', label: 'No one went in motion', response: 'Motion is optional. On a later play, watch for someone crossing behind the line before the ball is snapped.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The camera often arrives after players have moved. Try watching one wide receiver before the next snap; there is no need to identify the whole defense.' }
      ],
      diagramLabel: 'Illustration of a receiver moving sideways before the snap and a defender moving across with him. This movement is a clue, not proof of a coverage.',
      diagramCaption: 'Example only. A defender follows the motion; the defense could still change after the snap.'
    },
    {
      id: 'handoff_fake', title: 'Keep your eye on the ball',
      watch: 'Watch the quarterback’s hands when a runner passes close by. Who leaves with the ball?',
      shortWatch: 'Watch the exchange. Who leaves with the ball?',
      question: 'What did you see at the exchange?',
      explanation: 'A handoff gives the ball to the runner. In play action, the quarterback sells a handoff before trying to pass. Keeping the ball alone does not prove there was a fake.',
      concepts: ['quarterback', 'play_action', 'snap'],
      choices: [
        { id: 'handoff', label: 'Runner took the ball', response: 'That looks like a handoff. Next time, glance at the defenders nearby: which one moves toward the runner first?' },
        { id: 'fake', label: 'Fake handoff, then a throw', response: 'You may have spotted play action. The fake is meant to draw attention toward a run; whether it fooled a defender takes another look.' },
        { id: 'kept', label: 'Quarterback kept it', response: 'The quarterback might run, pass, or keep an option open. Look for the handoff motion before calling it a fake.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The exchange can be hidden by the players. A replay from behind the quarterback often gives a clearer view of the ball.' }
      ],
      diagramLabel: 'Illustration of a runner crossing beside the quarterback. Watch the point where their hands meet to see who keeps the ball.',
      diagramCaption: 'Example only. The paths show an exchange to watch, not a known handoff or fake.'
    },
    {
      id: 'deep_defenders', title: 'Look behind the defense',
      watch: 'Before the snap, look for the deepest defenders. Do they stay back or move forward?',
      shortWatch: 'Watch the deepest defenders before and after the snap.',
      question: 'What could you see at the back?',
      explanation: 'Deep defenders can help protect against long passes. Their starting positions show the space they could cover, but they may move into different jobs after the snap.',
      concepts: ['safety', 'snap', 'zone_coverage'],
      choices: [
        { id: 'one', label: 'One defender deep', response: 'One player deep in the middle can help over the top. That shape alone does not tell us whether the other defenders are following players or covering areas.' },
        { id: 'two', label: 'Two defenders deep', response: 'Two deep players can share the width of the field. Watch whether both stay back; one may move down as the play starts.' },
        { id: 'moved', label: 'They changed positions', response: 'That change is useful to notice. Defenses can show one arrangement before the snap and play another afterward.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The deepest defenders are often outside the TV picture. Wait for a wider shot rather than guessing how many are back there.' }
      ],
      diagramLabel: 'Illustration with two defenders behind the other players, each in a shaded deep area. These starting positions do not identify the coverage.',
      diagramCaption: 'Example only. Two players start deep; their jobs after the snap may differ.'
    },
    {
      id: 'route_break', title: 'Follow one receiver',
      watch: 'Pick a receiver you can see. Watch the moment he changes direction, even if the ball goes elsewhere.',
      shortWatch: 'Follow one receiver. Watch his change of direction.',
      question: 'Which way did your receiver go?',
      explanation: 'A route is the path a receiver runs. A sharp change of direction is a break. Watching the defender at that moment can help you see whether the receiver creates space.',
      concepts: ['receiver', 'line_of_scrimmage'],
      choices: [
        { id: 'inside', label: 'Toward the middle', response: 'An inside break brings the receiver toward the middle of the field. Look at the space between him and the nearest defender before and after the turn.' },
        { id: 'outside', label: 'Toward the sideline', response: 'An outside break takes the receiver toward a sideline. Watch whether the defender turns with him or has to recover ground.' },
        { id: 'straight', label: 'No turn that I saw', response: 'Some routes keep going upfield, and some turns happen off camera. Following the straight part still helps you see how the receiver and defender move together.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Try the receiver nearest the bottom of the TV picture next time. You only need to follow one player for a few seconds.' }
      ],
      diagramLabel: 'Illustration of a receiver running upfield, then turning toward the middle. A defender nearby shows the space to watch at the turn.',
      diagramCaption: 'Example only. One inside break is drawn; it is not the route from the live play.'
    },
    {
      id: 'screen_blockers', title: 'Watch who leads the way',
      watch: 'If a short pass goes near the line, look for blockers moving ahead of the receiver.',
      shortWatch: 'On a short pass, look for blockers ahead of the receiver.',
      question: 'What happened around the short pass?',
      explanation: 'A screen sets up a short pass with blockers leading the receiver. A short throw by itself is not enough to identify a screen; watch where the blockers go.',
      concepts: ['receiver', 'offensive_line', 'line_of_scrimmage'],
      choices: [
        { id: 'blockers', label: 'Blockers moved ahead', response: 'That may be a screen developing. Follow the first blocker and the defender he approaches; the useful detail is how space opens for the receiver.' },
        { id: 'none', label: 'No blockers ahead', response: 'It may simply have been a short pass, or the blockers may have been out of view. The distance of the throw alone does not identify the design.' },
        { id: 'other', label: 'There wasn’t a short pass', response: 'Save this for a play with a throw near the line. The clue is the blockers moving out to lead the receiver.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Try looking away from the ball just after the catch. The players in front of the receiver can be easier to spot then.' }
      ],
      diagramLabel: 'Illustration of a short pass to a receiver with two blockers ahead. A dashed line shows the pass and solid arrows show the blockers moving upfield.',
      diagramCaption: 'Example only. This screen illustration shows the blockers to look for.'
    },
    {
      id: 'pocket_edges', title: 'Watch the space around the quarterback',
      watch: 'On a pass play, watch the blockers around the quarterback. Where does that space start to close?',
      shortWatch: 'On a pass play, watch where the pocket closes.',
      question: 'Where did pressure seem to come from?',
      explanation: 'The pocket is the space the blockers try to hold around the quarterback. Pressure can come around an edge or through the middle. A sack alone does not tell us who missed an assignment.',
      concepts: ['pocket', 'offensive_line', 'quarterback'],
      choices: [
        { id: 'edge', label: 'Around an outside edge', response: 'An edge rusher is working around the outside of the protection. Watch whether the quarterback can step forward; there may still be room inside.' },
        { id: 'middle', label: 'Through the middle', response: 'Pressure inside can close the space directly in front of the quarterback. It can come from a defender winning a block or arriving through a gap; the result alone does not tell us which.' },
        { id: 'room', label: 'The quarterback had room', response: 'The protection held visible space long enough for you to notice. Now compare that with how quickly the quarterback releases the ball.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Start with the blocker at either end of the line. Watch that matchup for a moment instead of trying to follow every defender.' }
      ],
      diagramLabel: 'Illustration of blockers protecting a quarterback while a defender curves around one outside edge. The open space ahead of the quarterback is shaded.',
      diagramCaption: 'Example only. Pressure comes around the edge here; the live play may be different.'
    },
    {
      id: 'red_zone', title: 'Notice the shrinking space',
      watch: 'Near the end zone, watch how a receiver finds room with less field behind the defenders.',
      shortWatch: 'Near the end zone, watch how receivers find room.',
      question: 'How did the offense try to use the space?',
      explanation: 'The red zone is inside the opponent’s 20-yard line. As the offense gets closer, receivers have less room to run behind defenders before reaching the end line.',
      concepts: ['red_zone', 'receiver', 'quarterback'],
      choices: [
        { id: 'quick', label: 'A quick throw', response: 'A quick throw can use an opening before a defender closes it. Watch the receiver’s first few steps and when the ball leaves the quarterback’s hand.' },
        { id: 'wide', label: 'A throw toward the side', response: 'The offense may be using the width of the field. Look at the receiver’s space from both the defender and the boundary.' },
        { id: 'run', label: 'They ran the ball', response: 'On a run, look at the first gap the runner approaches. Notice whether it stays open or whether the runner changes direction.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Try comparing the receiver’s space with a play farther from the end zone. The boundary behind the defense is part of what changes.' }
      ],
      diagramLabel: 'Illustration of a receiver turning sideways near the end zone. The end line limits the space behind the defenders.',
      diagramCaption: 'Example only. The end line leaves less room behind the defense.'
    },
    {
      id: 'first_down_line', title: 'Find the first-down marker',
      watch: 'If there’s a catch, compare the catch point with the first-down marker. Is there still ground to cover?',
      shortWatch: 'On a catch, is there still ground to the marker?',
      question: 'Where was the catch relative to the marker?',
      explanation: 'A completed pass can still leave the offense short. The receiver may need yards after the catch to reach the marker; the final spot decides the next down.',
      concepts: ['sticks', 'receiver', 'line_of_scrimmage'],
      choices: [
        { id: 'short', label: 'Before the marker', response: 'The receiver still had ground to cover. Watch what happens after the catch, then check the final spot rather than the catch point alone.' },
        { id: 'beyond', label: 'At or beyond the marker', response: 'The catch looked deep enough. Possession, forward progress and any penalty still affect the official result, so check the final spot.' },
        { id: 'none', label: 'No catch on this play', response: 'There may still have been receivers running toward the marker. On the next completed pass, compare the catch point with where the play ends.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The yellow TV line is a useful guide, but it is not the official marker. The down and distance after the play can confirm whether the offense reached it.' }
      ],
      diagramLabel: 'Illustration of a catch before a dashed first-down marker, with an arrow showing the remaining ground to cover.',
      diagramCaption: 'Example only. The catch is short; the receiver still has ground to cover.'
    }
  ];
  // These are reading cues, not live formation or coverage diagnoses. Coaching
  // background: USA Football's "Coaching the Wide Receiver — 2nd Level Slot
  // Releases" (blog/7237), "The Spacing Pass Concept" (blog/7433), and
  // "Tempo Tools for Any Style of Offense" (blog/1739).
  var gameChanges = {
    motion: {
      title: 'Read the response to motion',
      watch: 'If a player goes in motion, watch who follows and who shifts. Then check whether that response holds after the snap.',
      shortWatch: 'If someone moves, watch the response before and after the snap.',
      question: 'How did the defense handle the movement?',
      explanation: 'Motion can change the numbers on one side or move a receiver into a different matchup. A defender traveling with him is one clue; several defenders passing him across can suggest shared responsibilities. Watch the next few steps before deciding what the response means.',
      followUp: 'Compare the moving player’s space before and after the snap. Did the movement create an easier release or bring another defender over?',
      choices: [
        { id: 'followed', label: 'One defender traveled with him', response: 'That suggests a personal matchup to watch. Follow both players after the snap: the defender may stay attached, switch assignments, or drop into an area. Traveling with motion alone does not prove man coverage.' },
        { id: 'shifted', label: 'Several defenders shifted', response: 'The defense appears to be adjusting together. Look for the nearest defender’s first step after the snap: does he follow the receiver, move toward the run, or protect space behind him? The shift alone does not identify the coverage.' },
        { id: 'stayed', label: 'The defense mostly stayed put', response: 'Now compare the players on the side the motion reached. The offense may have changed a matchup or added a blocker without moving the defense. That does not mean someone is uncovered; assignments may already account for the motion.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The camera may have missed the start. On the next motion, choose one nearby defender and follow him through the snap; you do not need to name the whole coverage.' }
      ]
    },
    handoff_fake: {
      title: 'Watch what the run action moves',
      watch: 'If the quarterback shows a handoff, watch a defender just behind the line. Does he step toward the runner or hold his ground?',
      shortWatch: 'If there’s a handoff look, watch the defender behind the line.',
      question: 'How did that defender react to the handoff look?',
      explanation: 'The same opening movement can lead to a run or a pass. A convincing handoff fake can pull a defender toward the line and leave space behind him. The useful question is whether the action moved that defender, then whether a receiver entered the space. Keeping the ball alone does not prove play action.',
      followUp: 'On a replay, follow the defender instead of the ball. Compare his first step with where the pass goes.',
      choices: [
        { id: 'forward', label: 'He stepped toward the run', response: 'Look behind the space he left. If a receiver comes through there, you can see how run action might help the pass. One forward step does not prove the defender was fooled; he may have a run responsibility.' },
        { id: 'held', label: 'He stayed back', response: 'Holding that space may make a throw behind him harder. If the runner actually has the ball, look at who comes forward to meet him. The defender’s responsibility is still something to check, not assume.' },
        { id: 'no_exchange', label: 'No handoff look that I saw', response: 'Save this read for a play with a visible exchange or fake. You can still watch the defender’s first step, but there is no reason to attribute it to a handoff fake.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The exchange and the defender are hard to follow at once. A replay from behind the offense often shows whether the defender moved and what opened behind him.' }
      ],
      diagramLabel: 'Illustration of a possible handoff fake drawing a defender forward, with a receiver crossing the space behind him. The diagram does not identify a live play.',
      diagramCaption: 'Example only. Run action can draw attention forward; watch whether a receiver reaches the space behind.'
    },
    deep_defenders: {
      title: 'Find the help behind the matchup',
      watch: 'If the camera shows the deep defenders, watch where they move after the snap. Which receivers have help over the top?',
      shortWatch: 'If the deep defenders are visible, watch where their help goes.',
      question: 'Where did the deep help move?',
      explanation: 'A receiver’s nearest defender may have help behind him. That help affects how much room the receiver has deep and how aggressively the nearer defender can play. One or two players starting deep is a useful picture, but their movement after the snap matters more than that first look.',
      followUp: 'Pick one receiver and compare the defender beside him with the deeper player. Watch the space between those two defenders.',
      choices: [
        { id: 'middle', label: 'Toward the middle', response: 'Help moving toward the middle may protect a crossing or deep inside route. Look toward the outside receivers too: is there still a second defender in position to help? The camera may not show the whole answer.' },
        { id: 'outside', label: 'Toward a sideline', response: 'That movement may help an outside matchup. Watch whether a receiver runs into the space the deep defender left. It is a clue about how the defense shares the field, not a complete coverage diagnosis.' },
        { id: 'forward', label: 'One moved toward the line', response: 'A defender moving down can change both the nearby matchup and the space behind him. Check whether someone else moves across to cover that space before calling it open.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Deep help is often outside the broadcast picture. A wider replay can make this read possible; do not fill in the missing defenders from the result of the pass.' }
      ]
    },
    route_break: {
      title: 'Read the space a defender gives up',
      watch: 'Pick a receiver and his nearest defender. Watch which side the defender protects, then where the receiver makes his turn.',
      shortWatch: 'Follow one matchup. Which side does the defender protect?',
      question: 'What changed when the receiver turned?',
      explanation: 'A defender’s position makes one path harder and may leave more room on another. Coaches call that leverage. A receiver can threaten one direction to make the defender turn, then break the other way. The space gained at the turn often tells you more than the route’s name.',
      followUp: 'Compare the gap just before and just after the turn. A receiver can create useful space even when the ball goes elsewhere.',
      choices: [
        { id: 'separated', label: 'The receiver gained space', response: 'Look at what came before the turn: speed, a step in the other direction, or the defender turning his hips. That movement may explain the separation. Deep help can still close the throwing window.' },
        { id: 'stayed', label: 'The defender stayed close', response: 'The defender may have protected the side the receiver wanted. Watch whether the receiver has another turn or whether a teammate’s route changes the space. Staying close does not reveal the full assignment.' },
        { id: 'straight', label: 'No turn that I could see', response: 'A straight route can still force the defender to turn and run, opening space underneath for someone else. Look for that relationship without assuming it was the intended design.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Choose a receiver near the bottom of the screen next time. First notice which side the defender stands on; then follow the first change of direction.' }
      ],
      diagramLabel: 'Illustration of a defender starting inside a receiver, who runs upfield and breaks outside. The diagram highlights the side protected and the space at the turn.',
      diagramCaption: 'Example only. This defender starts inside; the receiver threatens upfield, then breaks outside.'
    },
    screen_blockers: {
      title: 'Count the help around a short throw',
      watch: 'If a short pass goes near the line, look ahead of the receiver. How many blockers can reach the nearest defenders?',
      shortWatch: 'On a short pass, compare the blockers with the nearest defenders.',
      question: 'What did the receiver have in front of him?',
      explanation: 'A short throw can move the ball into space for a runner and his blockers. On a screen, the offense tries to arrange those blocks before defenders arrive. Count the nearby players, then watch the first block; numbers only help if the blockers can reach their defenders.',
      followUp: 'Follow the first blocker through the catch. Does he clear a path, or does a defender get around him?',
      choices: [
        { id: 'help', label: 'Blockers in position to help', response: 'Now watch the receiver’s path behind those blocks. He may wait briefly or cut behind a blocker. That relationship is a stronger screen clue than a short throw by itself.' },
        { id: 'defender', label: 'A defender arrived first', response: 'The defender may have beaten a block, recognized the developing play, or simply started close enough. A replay can help separate those explanations; the tackle alone cannot.' },
        { id: 'other', label: 'No short pass near the line', response: 'Keep this read for a throw near the line. Blockers leading a receiver are the feature to watch; a pass somewhere else does not tell us whether a screen was available.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'After the catch, look just ahead of the receiver. One blocker and the defender he approaches are enough to start reading the play.' }
      ]
    },
    pocket_edges: {
      title: 'Read how the protection holds up',
      watch: 'On a pass play, follow one blocker and rusher. Does the rusher win around him, come through untouched, or stay outside the quarterback’s space?',
      shortWatch: 'On a pass play, follow one blocker against one rusher.',
      question: 'What happened in that part of the protection?',
      explanation: 'The protection buys time and space for the pass. A defender beating a blocker is different from a defender arriving without being blocked. The quarterback’s movement also changes the angle of the rush. Watch the path before assigning blame; a sack does not tell you the intended blocking assignments.',
      followUp: 'Watch the quarterback’s feet with the same matchup in view. Does stepping forward create room, or is the middle closing too?',
      choices: [
        { id: 'beat', label: 'The rusher got past a blocker', response: 'You have a specific matchup to revisit. Was the path around the outside or through the inside shoulder? Then check whether the quarterback could move away; the wider protection may matter too.' },
        { id: 'free', label: 'The rusher came through untouched', response: 'An untouched rusher can come from several designs or mistakes, including a play expecting a quick throw. You can describe the free path without deciding who missed an assignment or declaring it a blitz.' },
        { id: 'held', label: 'The blocker kept him away', response: 'That matchup left the quarterback some space. Compare how long the block lasted with the timing of the throw, and remember another rusher may be arriving outside your view.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Start with the blocker at one end of the line. A replay showing the quarterback and that edge together helps connect the rush with his movement.' }
      ]
    },
    red_zone: {
      title: 'Read how they create room near the goal',
      watch: 'Near the end zone, watch two receivers on the same side. Do their first steps pull defenders apart or bring them together?',
      shortWatch: 'Near the end zone, watch how two receivers change the spacing.',
      question: 'How did the receivers use the limited space?',
      explanation: 'Near the goal, defenders have less field to protect behind them. The offense can use width, quick changes of direction, or receivers crossing at different depths to create a small opening. Watch how two routes affect the same patch of space rather than waiting only for someone to run free.',
      followUp: 'Notice when the quarterback releases the pass relative to the receiver’s turn. A small opening may last only a moment.',
      choices: [
        { id: 'apart', label: 'They spread the defenders out', response: 'Look at the space between the defenders. Separating the routes can make one defender choose which area to protect, but another defender may still be in position to help.' },
        { id: 'crossed', label: 'Their paths crossed', response: 'Crossing paths can make defenders work through traffic or exchange assignments. Watch whether they stay with a receiver or pass him to a teammate; the crossing itself does not prove anyone was blocked or picked.' },
        { id: 'run', label: 'They ran the ball', response: 'Watch the same spacing near the line: where does the offense have a blocker for the nearest defender, and where does a defender arrive free? The runner may have to change the path if that space closes.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'On the replay, choose the side with two visible receivers. Compare where they start with where they are when the ball leaves the quarterback’s hand.' }
      ]
    },
    first_down_line: {
      title: 'Read the routes around the marker',
      watch: 'Before a short throw, watch whether the nearest defender is already moving toward the receiver or is held deeper by another route. Can the receiver turn upfield before that defender closes?',
      shortWatch: 'Watch what holds the nearest defender away from the short route.',
      question: 'What was between the catch and the marker?',
      explanation: 'The first-down marker shapes the contest, especially on third down. A defender may protect the line and allow a catch in front of it; the offense may try to create room to run after a shorter throw. A completion short of the marker is not enough to judge the decision without seeing the space and the alternatives.',
      followUp: 'Compare the catch point with the final spot. The distance left and the defender’s angle help explain whether the receiver could keep going.',
      choices: [
        { id: 'space', label: 'The receiver had room to run', response: 'That room may give a short throw a route to the first down. Watch the receiver’s angle and the defender closing from the side; open grass does not guarantee the remaining yards.' },
        { id: 'defender', label: 'A defender was waiting short of it', response: 'The catch still left a contested stretch of field. Watch whether the receiver could turn upfield before contact. We cannot tell from the completion alone whether a deeper option was available.' },
        { id: 'beyond', label: 'The catch reached the marker', response: 'Now check the final spot. The receiver may have caught the ball moving back toward the quarterback, and possession, forward progress or a penalty can still affect the result.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The TV line is a guide, not the official marker. Check the next down and distance, then use a replay to see the catch point and the defender’s angle.' }
      ]
    }
  };
  var extraLessons = [
    {
      id: 'defender_conflict', title: 'Find the defender with two threats',
      watch: 'If two receivers head toward the same side at different depths, watch the defender between them. Which threat does he move toward?',
      shortWatch: 'If two routes share a side, watch the defender between them.',
      question: 'Which space did that defender protect?',
      explanation: 'Two routes at different depths can make one defender choose between a short throw and a deeper one. Following that defender can help you see why a throwing window appears. Other defenders may share those responsibilities, so two nearby receivers do not automatically mean an open pass.',
      followUp: 'Follow the defender’s first movement, then look at the other receiver. This shows a possible tradeoff, not the quarterback’s known read.',
      concepts: ['receiver', 'zone_coverage', 'quarterback'],
      choices: [
        { id: 'short', label: 'He moved toward the short route', response: 'Look behind him for the deeper receiver. That movement may open a window, but a second defender could be closing it. Compare when the space opens with when the quarterback can throw.' },
        { id: 'deep', label: 'He stayed with the deeper route', response: 'The shorter receiver may have space underneath. Check whether another defender can reach him quickly; the offense still needs useful yards after a short catch.' },
        { id: 'shared', label: 'Two defenders shared the routes', response: 'The defense may have enough help to cover both levels. Watch how they pass the receivers across and whether either player enters the gap between them.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'A wide replay helps. Pick two receivers going toward the same sideline, then watch the nearest defender positioned between their paths.' }
      ],
      diagramLabel: 'Illustration of two receivers running toward the same side at different depths, with one defender between them. Either space may have other defensive help not shown.',
      diagramCaption: 'Example only. Two depths ask a defender to divide his attention; other defensive help is not shown.'
    },
    {
      id: 'catch_and_run', title: 'What created the room after the catch?',
      watch: 'Before the catch, follow the nearest defender. Is another route pulling him away, is a blocker between him and the receiver, or does he have a clear path to the tackle?',
      shortWatch: 'Before the catch, watch what separates the receiver from the nearest defender.',
      question: 'What happened immediately after the catch?',
      explanation: 'Room after a short catch can be created before the ball arrives. A deeper route may hold a defender away; a crossing route may make him work through traffic; a blocker may close his path to the receiver. Separate that space from a gain the receiver creates by breaking a tackle. The same total yardage can come from very different plays.',
      followUp: 'On the replay, trace the nearest defender backward from the tackle. What delayed his arrival: another route, a block, his starting position, or the receiver beating him? The written report may not establish the cause.',
      concepts: ['receiver', 'line_of_scrimmage', 'sticks'],
      choices: [
        { id: 'stride', label: 'He caught it with room to run', response: 'Catching in stride can help the receiver use that room before defenders close. Compare his path with the nearest defender’s angle. The space may come from several routes or defensive choices we cannot see.' },
        { id: 'block', label: 'A block or missed tackle helped', response: 'Follow that moment separately from the throw. It can explain why the final gain was much longer than the distance to the catch without turning a short completion into a deep pass.' },
        { id: 'stopped', label: 'He was stopped near the catch', response: 'Most of the gain may have come before the catch. Watch whether the receiver had to slow down or turn and how close the defender was; the total alone cannot explain why the play ended there.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Look for the catch point on a replay, then follow the receiver to the final spot. If the feed does not report where the catch happened, keep that part uncertain.' }
      ],
      diagramLabel: 'Illustration separating a pass to the catch point from a receiver’s run to the final spot. The dashed blue path is the throw and the solid green path is the run, with no live distances implied.',
      diagramCaption: 'Example only. Dashed blue: throw to the catch. Solid green: run after the catch. No live route or distance is implied.'
    },
    {
      id: 'recurring_look', title: 'Compare what starts the same',
      watch: 'Pick one feature of the formation, such as two receivers on one side. If you see that look again, compare their first few steps.',
      shortWatch: 'If a formation looks familiar, compare the first few steps.',
      question: 'Did you notice a similar setup earlier?',
      explanation: 'An offense can use the same starting arrangement for different plays. A receiver or runner showing the same first steps may draw a familiar defensive response before changing direction. Comparing two plays helps you notice that relationship without assuming the formation tells you which play is coming.',
      followUp: 'Remember one visible detail: where the runner stands or which side has two receivers. Compare that detail when it returns, even if the result is different.',
      concepts: ['receiver', 'motion', 'play_action'],
      choices: [
        { id: 'same', label: 'Similar start, similar movement', response: 'That gives you one repeated feature to track. Compare how the defense responds this time. Two similar plays are an observation, not enough to know what the offense will call next.' },
        { id: 'changed', label: 'Similar start, different movement', response: 'Look for the point where the paths separated from what you remembered. The offense may be presenting a familiar look with a different option, but we cannot confirm the coach’s intent from the resemblance alone.' },
        { id: 'first', label: 'I haven’t noticed it before', response: 'Use this as your first reference. Pick just one feature to remember; there is no need to memorize all eleven starting positions.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Broadcast angles can make the same arrangement look different. Start with a simple count of receivers on each side, and wait until you have a clear comparison.' }
      ],
      diagramLabel: 'Illustration of one receiver starting upfield, with two alternative paths after the same first steps. These are possibilities from one setup, not two observed live plays.',
      diagramCaption: 'Example only. One starting look, two possible paths. The dashed branch is an alternative, not a second receiver.'
    }
  ];
  basicLessons = basicLessons.map(function (lesson) { return Object.assign({}, lesson, { level: 'basics' }); });
  var gameLessons = basicLessons.map(function (lesson) {
    return Object.assign({}, lesson, gameChanges[lesson.id], { level: 'game' });
  }).concat(extraLessons.map(function (lesson) { return Object.assign({}, lesson, { level: 'game' }); }));
  freeze(basicLessons); freeze(gameLessons);

  function levelOf(options) { return options && options.level === 'basics' ? 'basics' : 'game'; }
  function all(options) { return levelOf(options) === 'basics' ? basicLessons : gameLessons; }
  function get(id, options) {
    return all(options).find(function (lesson) { return lesson.id === id; }) || null;
  }

  function choose(sit, options) {
    if (!sit || !Number.isInteger(sit.down) || sit.down < 1 || sit.down > 3 ||
        !Number.isInteger(sit.distance) || sit.distance < 1 ||
        !Number.isInteger(sit.yardsToGoal) || sit.yardsToGoal < 1 || sit.yardsToGoal > 99 ||
        sit.distance > sit.yardsToGoal) return null;
    if ((sit.period === 2 || sit.period === 4) && sit.clockSeconds === 0) return null;
    if (sit.yardsToGoal <= 10) return get('red_zone', options);
    var ids = sit.distance <= 3 ? ['motion', 'handoff_fake', 'first_down_line'] :
      sit.down === 3 && sit.distance >= 7 ? ['deep_defenders', 'route_break', 'pocket_edges', 'first_down_line'] :
      ['motion', 'handoff_fake', 'deep_defenders', 'route_break', 'screen_blockers', 'pocket_edges', 'first_down_line'];
    if (levelOf(options) === 'game') {
      if (sit.distance > 3) ids = ids.concat('defender_conflict', 'catch_and_run');
      if (sit.down < 3) ids = ids.concat('recurring_look');
    }
    if (sit.yardsToGoal <= 20) ids = ids.concat('red_zone');
    if (sit.distance === sit.yardsToGoal) ids = ids.filter(function (id) { return id !== 'first_down_line'; });
    // Stable while only the clock changes. The input is context for a teaching
    // prompt, never evidence of the formation or what the next play will be.
    var period = Number.isInteger(sit.period) && sit.period > 0 ? sit.period : 0;
    return get(ids[(sit.down * 11 + sit.distance * 7 + sit.yardsToGoal + period * 3) % ids.length], options);
  }

  function observationResponse(id, choiceId, options) {
    var lesson = get(id, options);
    var choice = lesson && lesson.choices.find(function (item) { return item.id === choiceId; });
    return choice ? choice.response : null;
  }

  // Accept the released FootballPlay.describe result, not arbitrary raw prose.
  // This selects a related topic, not a reconstruction or explanation of cause.
  function relatedToReport(report, options) {
    if (!report || report.voidReason && !/^Sack\./.test(report.summary || '')) return null;
    var facts = Array.isArray(report.facts) ? report.facts : [];
    var id = null, reason = '';
    if (/^Sack\.|^Quarterback scramble\b/.test(report.summary || '')) {
      id = 'pocket_edges'; reason = 'The report mentions a sack or scramble. This example shows where to look for pressure; it does not identify its cause on that play.';
    } else if (facts.some(function (fact) { return /^Deep pass(?: to the (?:left|right)| over the middle)?$/.test(fact); })) {
      id = 'deep_defenders'; reason = 'The report describes a deep pass. This example explains the defenders to watch; their coverage was not reported.';
    } else if (report.outcome === 'pass' && typeof report.need === 'number' && report.need > 0 &&
        typeof report.gained === 'number' && /^Pass complete\b/.test(report.summary || '')) {
      var reconciledRun = (report.depthSource === 'reported' || report.depthSource === 'reported spots') &&
        Number.isInteger(report.airYards) && Number.isInteger(report.yardsAfterCatch) &&
        report.airYards + report.yardsAfterCatch === report.gained && report.yardsAfterCatch > Math.max(0, report.airYards);
      id = reconciledRun && levelOf(options) === 'game' ? 'catch_and_run' : 'first_down_line';
      reason = reconciledRun && levelOf(options) === 'game' ?
        'The reported distances show that more of the gain came after the catch. This example separates the throw from the run without assigning a cause.' :
        typeof report.depthText === 'string' && report.depthText.trim() ?
          'The catch position is reported. This example explains the marker; it does not show the receiver’s actual route.' :
          'The report includes a completed pass and the yards needed. This example explains the marker; the report does not locate the catch itself.';
    }
    return id ? { lesson: get(id, options), reason: reason } : null;
  }

  function escape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function label(x, y, text, extra) {
    return '<text class="learning-svg-label ' + (extra || '') + '" x="' + x + '" y="' + y + '">' + escape(text) + '</text>';
  }
  function player(x, y, text) {
    return '<circle class="learning-offense" cx="' + x + '" cy="' + y + '" r="10"/>' +
      (text ? label(x, y + 4, text, 'learning-player-label') : '');
  }
  function defender(x, y) {
    return '<path class="learning-defense" d="M' + (x - 7) + ' ' + (y - 7) + 'l14 14m0 -14l-14 14"/>';
  }
  function arrow(path, x, y, rotate, extra) {
    return '<path class="learning-route ' + (extra || '') + '" d="' + path + '"/>' +
      '<path class="learning-arrowhead ' + (extra || '') + '" d="M-5 7L0 0 5 7" transform="translate(' + x + ' ' + y + ') rotate(' + rotate + ')"/>';
  }
  function line() {
    return [200, 220, 240, 260, 280].map(function (x) { return player(x, 196); }).join('');
  }
  function diagramBody(id, level) {
    if (id === 'defender_conflict') return line() + player(240, 234, 'Q') +
      player(76, 199, 'R') + player(146, 199, 'R') + defender(329, 129) +
      arrow('M76 186 V80 H395', 395, 80, 90) + arrow('M146 186 V160 H395', 395, 160, 90) +
      '<ellipse class="learning-highlight" cx="329" cy="129" rx="22" ry="23"/>' +
      label(178, 67, 'Deeper route', 'learning-svg-small') + label(190, 149, 'Short route', 'learning-svg-small');
    if (id === 'catch_and_run') return line() + player(240, 234, 'Q') + player(357, 157, 'R') +
      defender(416, 98) + arrow('M252 226 L344 167', 344, 167, 56, 'learning-pass') +
      arrow('M357 143 Q350 110 315 81', 315, 81, -46) +
      '<circle class="learning-highlight" cx="357" cy="157" r="20"/>' +
      label(298, 192, 'Catch here', 'learning-svg-small') + label(265, 67, 'Play ends here', 'learning-svg-small') +
      label(45, 113, 'Throw + run', 'learning-svg-small');
    if (id === 'recurring_look') return line() + player(240, 235, 'Q') + player(127, 203, 'R') +
      defender(159, 131) + '<path class="learning-route" d="M127 190V103"/>' +
      arrow('M127 103 H355', 355, 103, 90) + arrow('M127 103 V64', 127, 64, 0, 'learning-alternative') +
      '<circle class="learning-highlight" cx="127" cy="103" r="18"/>' +
      label(37, 238, 'Same start', 'learning-svg-small') +
      label(219, 87, 'Two possible paths', 'learning-svg-small');
    if (id === 'handoff_fake' && level === 'game') return line() + player(240, 229, 'Q') +
      player(165, 231, 'R') + defender(244, 137) + player(74, 200, 'R') +
      arrow('M178 234 Q231 253 301 224', 301, 224, 61) +
      arrow('M244 151 V169', 244, 169, 180, 'learning-defender-path') +
      arrow('M74 186 V109 H349', 349, 109, 90) +
      label(170, 87, 'Space behind him', 'learning-svg-small');
    if (id === 'route_break' && level === 'game') return line() + player(240, 232, 'Q') +
      player(139, 203, 'R') + defender(170, 155) +
      arrow('M139 190 V100 H66', 66, 100, -90) +
      '<circle class="learning-highlight" cx="139" cy="100" r="18"/>' +
      label(202, 137, 'Defender starts inside', 'learning-svg-small') +
      label(35, 78, 'Break outside', 'learning-svg-small');
    if (id === 'motion') return line() + player(240, 230, 'Q') + player(68, 212, 'R') + defender(80, 146) +
      arrow('M82 218 Q220 248 364 214', 364, 214, 65) +
      arrow('M94 146 H363', 363, 146, 90, 'learning-defender-path') +
      label(33, 83, 'Before the snap') + label(196, 131, 'Does a defender follow?');
    if (id === 'handoff_fake') return line() + player(240, 223, 'Q') + player(164, 229, 'R') +
      '<ellipse class="learning-highlight" cx="240" cy="232" rx="28" ry="20"/>' +
      arrow('M177 233 Q236 253 303 226', 303, 226, 62) +
      label(34, 85, 'Who keeps the ball?') +
      '<path class="learning-guide" d="M164 98 L227 209"/>';
    if (id === 'deep_defenders') return '<ellipse class="learning-zone" cx="140" cy="104" rx="78" ry="40"/>' +
      '<ellipse class="learning-zone" cx="340" cy="104" rx="78" ry="40"/>' + defender(140, 105) + defender(340, 105) +
      defender(185, 160) + defender(295, 160) + line() + player(240, 232, 'Q') +
      label(80, 70, 'Deep defenders') + label(237, 148, 'Space underneath', 'learning-svg-small');
    if (id === 'route_break') return line() + player(240, 231, 'Q') + player(75, 199, 'R') + defender(115, 139) +
      arrow('M75 186 V99 H195', 195, 99, 90) +
      '<circle class="learning-highlight" cx="75" cy="99" r="19"/>' +
      label(112, 77, 'The turn') + label(284, 113, 'Watch the space', 'learning-svg-small');
    if (id === 'screen_blockers') return player(235, 229, 'Q') + player(373, 205, 'R') +
      player(313, 168) + player(392, 147) + defender(345, 103) + defender(425, 92) +
      arrow('M249 226 L357 207', 357, 207, 80, 'learning-pass') +
      arrow('M314 154 L323 121', 323, 121, 15) + arrow('M392 134 V98', 392, 98, 0) +
      label(32, 83, 'Blockers lead the way') + label(140, 248, 'Short pass', 'learning-svg-small');
    if (id === 'pocket_edges') return '<path class="learning-zone" d="M187 197 Q182 237 240 253 Q298 237 293 197Z"/>' +
      line() + player(240, 230, 'Q') + defender(163, 162) +
      arrow('M152 166 Q128 227 202 239', 202, 239, 98, 'learning-defender-path') +
      arrow('M240 216 V177', 240, 177, 0) +
      label(33, 91, 'Pressure around the edge') + label(278, 235, 'Space to step into', 'learning-svg-small');
    if (id === 'red_zone' && level === 'game') return '<rect class="learning-endzone" x="22" y="50" width="436" height="45" rx="4"/>' +
      label(240, 78, 'END ZONE', 'learning-centered') +
      '<path class="learning-boundary" d="M23 50H457"/>' + label(38, 120, 'Use the width') +
      line() + player(240, 233, 'Q') + player(332, 200, 'R') + player(420, 200, 'R') +
      defender(354, 151) + defender(405, 129) +
      arrow('M332 187 V112 H381', 381, 112, 90) + arrow('M420 187 V163 H376', 376, 163, -90);
    if (id === 'red_zone') return '<rect class="learning-endzone" x="22" y="50" width="436" height="45" rx="4"/>' +
      label(240, 78, 'END ZONE', 'learning-centered') +
      '<path class="learning-boundary" d="M23 50H457"/>' + label(38, 120, 'Less room behind') +
      defender(320, 118) + line() + player(240, 232, 'Q') + player(374, 199, 'R') +
      arrow('M374 186 V130 H413', 413, 130, 90);
    return '<path class="learning-marker" d="M24 115H456"/>' + label(30, 102, 'First-down marker') +
      line() + player(240, 231, 'Q') + player(371, 157, 'R') +
      (level === 'game' ? defender(342, 130) : '') + arrow('M253 225 L356 168', 356, 168, 58, 'learning-pass') +
      arrow('M371 143 V115', 371, 115, 0) + label(309, 88, 'Still to go', 'learning-svg-small');
  }

  function renderDiagram(id, options) {
    var lesson = get(id, options);
    if (!lesson) return '';
    // No IDs, external URLs, or raw data are interpolated, so repeated examples
    // on the same page cannot collide or inject markup.
    return '<svg class="learning-diagram" viewBox="0 0 480 300" role="img" aria-label="' + escape(lesson.diagramLabel) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect class="learning-pitch" x="0" y="0" width="480" height="300" rx="14"/>' +
      label(22, 25, 'EXAMPLE ONLY', 'learning-svg-overline') + label(459, 25, 'Offense moves ↑', 'learning-right') +
      '<rect class="learning-field-bound" x="22" y="48" width="436" height="212" rx="5"/>' +
      [92, 136, 180, 224].map(function (y) { return '<path class="learning-yard-line" d="M23 ' + y + 'H457"/>'; }).join('') +
      '<path class="learning-scrimmage" d="M23 180H457"/>' +
      diagramBody(id, lesson.level) + player(34, 281) + label(52, 286, 'Offense', 'learning-svg-small') +
      defender(152, 281) + label(169, 286, 'Defense', 'learning-svg-small') +
      label(459, 286, 'Selected players shown', 'learning-right learning-svg-small') + '</svg>';
  }

  var api = freeze({ choose: choose, get: get, all: all,
    observationResponse: observationResponse, relatedToReport: relatedToReport, renderDiagram: renderDiagram });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballLearning = api;
})(typeof window !== 'undefined' ? window : null);
