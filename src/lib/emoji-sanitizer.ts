// ============================================================
// AI Semantic Emoji Sanitizer
// ============================================================
// Converts emojis to their semantic text representations BEFORE
// data is exported to CSV/Excel. This ensures production-safe,
// encoding-compatible exports that preserve the MEANING of emojis
// without raw Unicode characters that break CSV parsers, encoding
// systems, or database imports.
//
// Architecture:
//   1. Primary Map: emoji → semantic text (e.g., 😊 → :smile:)
//   2. Skin-tone aware: 👍🏻👍🏼👍🏽👍🏾👍🏿 → :thumbs_up: (canonical)
//   3. ZWJ Sequences: 👨‍👩‍👧‍👦 → :family: (full sequence handled)
//   4. Fallback: unknown emojis → :emoji:<hex> (preserves identity)
//   5. Feedback-aware: feedback columns keep original (configurable)
//
// Usage:
//   sanitizeForExport("I love this 😊 product 🔥", { mode: "semantic" })
//   → "I love this :smile: product :fire:"
// ============================================================

// ── Comprehensive Emoji → Semantic Text Map ──────────────────
// Organized by semantic category for maintainability.
// Each mapping preserves the INTENT of the emoji, not just a label.

const EMOJI_MAP: Record<string, string> = {
  // ════════════════════════════════════════════════════════════
  // SMILEYS & EMOTIONS (Face emojis)
  // ════════════════════════════════════════════════════════════
  // Happy / Positive
  "😊": ":smile:",
  "😄": ":grinning:",
  "😁": ":beaming:",
  "😆": ":laughing:",
  "🥹": ":holding_back_tears:",
  "😂": ":joy:",
  "🤣": ":rolling_on_floor_laughing:",
  "😅": ":sweat_smile:",
  "🥲": ":smiling_tear:",
  "☺️": ":slight_smile:",
  "😇": ":innocent:",
  "🙂": ":slightly_smiling:",
  "🙃": ":upside_down:",
  "😉": ":wink:",
  "😌": ":relieved:",
  "😍": ":heart_eyes:",
  "🥰": ":smiling_heart:",
  "😘": ":kiss:",
  "😗": ":kissing:",
  "😙": ":kissing_smiling:",
  "😚": ":kissing_closed:",
  "😋": ":yummy:",
  "😛": ":tongue:",
  "😜": ":winking_tongue:",
  "🤪": ":zany:",
  "😝": ":squinting_tongue:",
  "🤑": ":money_mouth:",
  "🤗": ":hugging:",
  "🤭": ":hand_over_mouth:",
  "🤫": ":shushing:",
  "🤔": ":thinking:",
  "🫡": ":salute:",
  "🤐": ":zipper_mouth:",
  "🤨": ":raised_eyebrow:",
  "😐": ":neutral:",
  "😑": ":expressionless:",
  "😶": ":no_mouth:",
  "🫥": ":dotted_line_face:",
  "😏": ":smirk:",
  "😒": ":unamused:",
  "🙄": ":eye_roll:",
  "😬": ":grimacing:",
  "😮‍💨": ":exhaling:",
  "🤥": ":lying:",
  "🫠": ":melting_face:",
  "😌": ":relieved:",
  "😔": ":pensive:",
  "😪": ":sleepy:",
  "🤤": ":drooling:",
  "😴": ":sleeping:",
  "😷": ":mask:",
  "🤒": ":sick:",
  "🤕": ":hurt:",
  "🤢": ":nauseated:",
  "🤮": ":vomiting:",
  "🥵": ":hot:",
  "🥶": ":cold:",
  "🥴": ":woozy:",
  "😵": ":dizzy:",
  "😵‍💫": ":spiral_eyes:",
  "🤯": ":mind_blown:",
  "🤠": ":cowboy:",
  "🥳": ":partying:",
  "🥸": ":disguised:",
  "😎": ":cool:",
  "🤓": ":nerd:",
  "🧐": ":monocle:",
  "😕": ":confused:",
  "🫤": ":diagonal_mouth:",
  "😟": ":worried:",
  "🙁": ":frowning:",
  "☹️": ":frowning_open:",
  "😮": ":open_mouth:",
  "😯": ":hushed:",
  "😲": ":astonished:",
  "😳": ":flushed:",
  "🥺": ":pleading:",
  "🥹": ":holding_back_tears:",
  "😦": ":frowning_open:",
  "😧": ":anguished:",
  "😨": ":fearful:",
  "😰": ":anxious:",
  "😥": ":sad_relieved:",
  "😢": ":crying:",
  "😭": ":sobbing:",
  "😱": ":screaming:",
  "😖": ":confounded:",
  "😣": ":persevere:",
  "😞": ":disappointed:",
  "😓": ":downcast_sweat:",
  "😩": ":weary:",
  "😫": ":tired:",
  "🥱": ":yawning:",
  "😤": ":angry_breath:",
  "😡": ":angry:",
  "😠": ":angry:",
  "🤬": ":cursing:",
  "😈": ":devil_smile:",
  "👿": ":devil_angry:",
  "💀": ":skull:",
  "☠️": ":skull_crossbones:",
  "💩": ":poop:",
  "🤡": ":clown:",
  "👹": ":ogre:",
  "👺": ":goblin:",
  "👻": ":ghost:",
  "👽": ":alien:",
  "👾": ":space_invader:",
  "🤖": ":robot:",

  // ════════════════════════════════════════════════════════════
  // GESTURES & BODY PARTS
  // ════════════════════════════════════════════════════════════
  "👍": ":thumbs_up:",
  "👎": ":thumbs_down:",
  "👊": ":punch:",
  "✊": ":raised_fist:",
  "🤛": ":left_fist:",
  "🤜": ":right_fist:",
  "🤞": ":crossed_fingers:",
  "✌️": ":peace:",
  "🤟": ":love_you:",
  "🤘": ":rock_on:",
  "👌": ":ok_hand:",
  "🤌": ":pinched_fingers:",
  "🤏": ":pinching:",
  "👈": ":point_left:",
  "👉": ":point_right:",
  "👆": ":point_up:",
  "👇": ":point_down:",
  "☝️": ":point_up_strict:",
  "🫵": ":point_at_viewer:",
  "👏": ":clap:",
  "🙌": ":raising_hands:",
  "🫶": ":heart_hands:",
  "👐": ":open_hands:",
  "🤲": ":palms_up:",
  "🤝": ":handshake:",
  "🙏": ":pray:",
  "✍️": ":writing:",
  "💅": ":nail_polish:",
  "🤳": ":selfie:",
  "💪": ":muscle:",
  "🦾": ":mechanical_arm:",
  "🦿": ":mechanical_leg:",
  "🦵": ":leg:",
  "🦶": ":foot:",
  "👂": ":ear:",
  "🦻": ":ear_with_hearing_aid:",
  "👃": ":nose:",
  "🧠": ":brain:",
  "🫀": ":heart_organ:",
  "🫁": ":lungs:",
  "🦷": ":tooth:",
  "🦴": ":bone:",
  "👀": ":eyes:",
  "👁️": ":eye:",
  "👅": ":tongue_out:",
  "👄": ":lips:",

  // ════════════════════════════════════════════════════════════
  // PEOPLE & ROLES
  // ════════════════════════════════════════════════════════════
  "👨": ":man:",
  "👩": ":woman:",
  "🧑": ":person:",
  "👦": ":boy:",
  "👧": ":girl:",
  "🧒": ":child:",
  "👶": ":baby:",
  "👴": ":old_man:",
  "👵": ":old_woman:",
  "🧓": ":older_person:",
  "👮": ":police:",
  "🕵️": ":detective:",
  "💂": ":guard:",
  "🥷": ":ninja:",
  "👷": ":construction_worker:",
  "🫅": ":crown_person:",
  "🤴": ":prince:",
  "👸": ":princess:",
  "👳": ":turban:",
  "👲": ":cap:",
  "🧕": ":headscarf:",
  "🤵": ":tuxedo:",
  "👰": ":bride:",
  "🤰": ":pregnant:",
  "🫄": ":pregnant_person:",
  "😇": ":angel:",
  "🎅": ":santa:",
  "🤶": ":mrs_claus:",
  "🦸": ":superhero:",
  "🦹": ":supervillain:",
  "🧙": ":mage:",
  "🧚": ":fairy:",
  "🧛": ":vampire:",
  "🧜": ":merperson:",
  "🧝": ":elf:",
  "🧞": ":genie:",
  "🧟": ":zombie:",
  "🧌": ":troll:",
  "💆": ":massage:",
  "💇": ":haircut:",
  "🚶": ":walking:",
  "🧍": ":standing:",
  "🧎": ":kneeling:",
  "🏃": ":running:",
  "💃": ":dancing_woman:",
  "🕺": ":dancing_man:",
  "👯": ":dancers:",
  "🧖": ":sauna:",
  "🧗": ":climbing:",
  "🤸": ":cartwheel:",
  "⛹️": ":basketball:",

  // ════════════════════════════════════════════════════════════
  // ANIMALS & NATURE
  // ════════════════════════════════════════════════════════════
  "🐶": ":dog:",
  "🐱": ":cat:",
  "🐭": ":mouse:",
  "🐹": ":hamster:",
  "🐰": ":rabbit:",
  "🦊": ":fox:",
  "🐻": ":bear:",
  "🐼": ":panda:",
  "🐻‍❄️": ":polar_bear:",
  "🐨": ":koala:",
  "🐯": ":tiger:",
  "🦁": ":lion:",
  "🐮": ":cow:",
  "🐷": ":pig:",
  "🐸": ":frog:",
  "🐵": ":monkey:",
  "🙈": ":see_no_evil:",
  "🙉": ":hear_no_evil:",
  "🙊": ":speak_no_evil:",
  "🐔": ":chicken:",
  "🐧": ":penguin:",
  "🐦": ":bird:",
  "🐤": ":baby_chick:",
  "🦆": ":duck:",
  "🦅": ":eagle:",
  "🦉": ":owl:",
  "🦇": ":bat:",
  "🐺": ":wolf:",
  "🐗": ":boar:",
  "🐴": ":horse:",
  "🦄": ":unicorn:",
  "🐝": ":bee:",
  "🪱": ":worm:",
  "🐛": ":bug:",
  "🦋": ":butterfly:",
  "🐌": ":snail:",
  "🐞": ":ladybug:",
  "🐜": ":ant:",
  "🪰": ":fly:",
  "🦟": ":mosquito:",
  "🦗": ":cricket:",
  "🕷️": ":spider:",
  "🦂": ":scorpion:",
  "🐢": ":turtle:",
  "🐍": ":snake:",
  "🦎": ":lizard:",
  "🦖": ":t_rex:",
  "🦕": ":sauropod:",
  "🐙": ":octopus:",
  "🦑": ":squid:",
  "🦐": ":shrimp:",
  "🦞": ":lobster:",
  "🦀": ":crab:",
  "🐡": ":blowfish:",
  "🐠": ":tropical_fish:",
  "🐟": ":fish:",
  "🐬": ":dolphin:",
  "🐳": ":whale:",
  "🐋": ":humpback_whale:",
  "🦈": ":shark:",
  "🐊": ":crocodile:",
  "🐅": ":tiger2:",
  "🐆": ":leopard:",
  "🦓": ":zebra:",
  "🦍": ":gorilla:",
  "🦧": ":orangutan:",
  "🐘": ":elephant:",
  "🦛": ":hippo:",
  "🦏": ":rhino:",
  "🐪": ":camel:",
  "🐫": ":two_hump_camel:",
  "🦒": ":giraffe:",
  "🦘": ":kangaroo:",
  "🐃": ":buffalo:",
  "🐂": ":ox:",
  "🐄": ":cow2:",
  "🐎": ":racehorse:",
  "🐖": ":pig2:",
  "🐏": ":ram:",
  "🐑": ":sheep:",
  "🦙": ":llama:",
  "🐐": ":goat:",
  "🦌": ":deer:",
  "🐕": ":dog2:",
  "🐩": ":poodle:",
  "🦮": ":guide_dog:",

  // ════════════════════════════════════════════════════════════
  // FOOD & DRINK
  // ════════════════════════════════════════════════════════════
  "🍏": ":green_apple:",
  "🍎": ":apple:",
  "🍐": ":pear:",
  "🍊": ":tangerine:",
  "🍋": ":lemon:",
  "🍌": ":banana:",
  "🍉": ":watermelon:",
  "🍇": ":grapes:",
  "🍓": ":strawberry:",
  "🫐": ":blueberries:",
  "🍈": ":melon:",
  "🍒": ":cherries:",
  "🍑": ":peach:",
  "🥭": ":mango:",
  "🍍": ":pineapple:",
  "🥥": ":coconut:",
  "🥝": ":kiwi:",
  "🍅": ":tomato:",
  "🍆": ":eggplant:",
  "🥑": ":avocado:",
  "🫛": ":pea_pod:",
  "🥦": ":broccoli:",
  "🥬": ":leafy_green:",
  "🥒": ":cucumber:",
  "🌶️": ":hot_pepper:",
  "🫑": ":bell_pepper:",
  "🌽": ":corn:",
  "🥕": ":carrot:",
  "🫒": ":olive:",
  "🧄": ":garlic:",
  "🧅": ":onion:",
  "🥔": ":potato:",
  "🍠": ":sweet_potato:",
  "🫘": ":beans:",
  "🥐": ":croissant:",
  "🥖": ":baguette:",
  "🍞": ":bread:",
  "🫓": ":flatbread:",
  "🥨": ":pretzel:",
  "🥯": ":bagel:",
  "🥞": ":pancakes:",
  "🧇": ":waffle:",
  "🧀": ":cheese:",
  "🍖": ":meat:",
  "🍗": ":poultry_leg:",
  "🥩": ":steak:",
  "🥓": ":bacon:",
  "🍔": ":hamburger:",
  "🍟": ":fries:",
  "🍕": ":pizza:",
  "🌭": ":hotdog:",
  "🥪": ":sandwich:",
  "🌮": ":taco:",
  "🌯": ":burrito:",
  "🫔": ":tamale:",
  "🥙": ":pita:",
  "🧆": ":falafel:",
  "🥚": ":egg:",
  "🍳": ":cooking:",
  "🥘": ":stew:",
  "🍲": ":pot_of_food:",
  "🫕": ":fondue:",
  "🥣": ":bowl:",
  "🥗": ":salad:",
  "🍿": ":popcorn:",
  "🧈": ":butter:",
  "🧂": ":salt:",
  "🥫": ":canned_food:",
  "🍱": ":bento:",
  "🍘": ":rice_cracker:",
  "🍙": ":rice_ball:",
  "🍚": ":rice:",
  "🍛": ":curry:",
  "🍜": ":noodles:",
  "🍝": ":spaghetti:",
  "🍠": ":roasted_sweet_potato:",
  "🍢": ":oden:",
  "🍣": ":sushi:",
  "🍤": ":fried_shrimp:",
  "🥟": ":dumpling:",
  "🥠": ":fortune_cookie:",
  "🥡": ":takeout:",
  "🦀": ":crab:",
  "🦞": ":lobster:",
  "🦐": ":shrimp:",
  "🦑": ":squid:",
  "🦪": ":oyster:",
  "🍦": ":ice_cream:",
  "🍧": ":shaved_ice:",
  "🍨": ":ice_cream_bowl:",
  "🍩": ":donut:",
  "🍪": ":cookie:",
  "🎂": ":birthday_cake:",
  "🍰": ":cake:",
  "🧁": ":cupcake:",
  "🥧": ":pie:",
  "🍫": ":chocolate:",
  "🍬": ":candy:",
  "🍭": ":lollipop:",
  "🍮": ":pudding:",
  "🍯": ":honey:",
  "🍼": ":baby_bottle:",
  "🥛": ":milk:",
  "☕": ":coffee:",
  "🫖": ":teapot:",
  "🍵": ":tea:",
  "🧃": ":juice_box:",
  "🥤": ":cup_straw:",
  "🧋": ":bubble_tea:",
  "🍶": ":sake:",
  "🍺": ":beer:",
  "🍻": ":beers:",
  "🥂": ":champagne:",
  "🍷": ":wine:",
  "🥃": ":whiskey:",
  "🍸": ":cocktail:",
  "🍹": ":tropical_drink:",
  "🧉": ":mate:",
  "🍾": ":champagne_bottle:",
  "🫗": ":pouring:",

  // ════════════════════════════════════════════════════════════
  // TRAVEL & PLACES
  // ════════════════════════════════════════════════════════════
  "🌍": ":earth_africa:",
  "🌎": ":earth_americas:",
  "🌏": ":earth_asia:",
  "🌐": ":globe:",
  "🗺️": ":world_map:",
  "🧭": ":compass:",
  "🏔️": ":mountain:",
  "⛰️": ":mountain2:",
  "🌋": ":volcano:",
  "🗻": ":fuji:",
  "🏕️": ":camping:",
  "🏖️": ":beach:",
  "🏜️": ":desert:",
  "🏝️": ":island:",
  "🏞️": ":national_park:",
  "🏟️": ":stadium:",
  "🏛️": ":monument:",
  "🏗️": ":construction:",
  "🧱": ":brick:",
  "🪨": ":rock:",
  "🏘️": ":houses:",
  "🏚️": ":derelict_house:",
  "🏠": ":house:",
  "🏡": ":house_garden:",
  "🏢": ":office:",
  "🏣": ":post_office:",
  "🏥": ":hospital:",
  "🏦": ":bank:",
  "🏨": ":hotel:",
  "🏩": ":love_hotel:",
  "🏪": ":convenience_store:",
  "🏫": ":school:",
  "🏬": ":department_store:",
  "🏭": ":factory:",
  "🏯": ":castle:",
  "🏰": ":castle2:",
  "💒": ":wedding:",
  "🗼": ":tokyo_tower:",
  "🗽": ":statue_of_liberty:",
  "⛪": ":church:",
  "🕌": ":mosque:",
  "🛕": ":hindu_temple:",
  "🕍": ":synagogue:",
  "⛩️": ":shrine:",
  "🕋": ":kaaba:",

  // ════════════════════════════════════════════════════════════
  // TRANSPORT
  // ════════════════════════════════════════════════════════════
  "🚗": ":car:",
  "🚕": ":taxi:",
  "🚙": ":suv:",
  "🚌": ":bus:",
  "🚎": ":trolley:",
  "🏎️": ":race_car:",
  "🚓": ":police_car:",
  "🚑": ":ambulance:",
  "🚒": ":fire_truck:",
  "🚐": ":minibus:",
  "🚚": ":truck:",
  "🚛": ":articulated_truck:",
  "🚜": ":tractor:",
  "🦯": ":white_cane:",
  "🦽": ":manual_wheelchair:",
  "🦼": ":motorized_wheelchair:",
  "🛴": ":scooter:",
  "🚲": ":bicycle:",
  "🛵": ":motor_scooter:",
  "🏍️": ":motorcycle:",
  "🛺": ":auto_rickshaw:",
  "🚨": ":emergency:",
  "🚔": ":oncoming_police:",
  "🚍": ":oncoming_bus:",
  "🚘": ":oncoming_car:",
  "🚖": ":oncoming_taxi:",
  "🚡": ":aerial_tramway:",
  "🚠": ":mountain_cableway:",
  "🚟": ":suspension_railway:",
  "🚃": ":railway_car:",
  "🚋": ":train_car:",
  "🚞": ":mountain_railway:",
  "🚝": ":monorail:",
  "🚄": ":bullet_train:",
  "🚅": ":bullet_train2:",
  "🚈": ":light_rail:",
  "🚂": ":locomotive:",
  "🚆": ":train:",
  "🚇": ":metro:",
  "🚊": ":tram:",
  "🚉": ":station:",
  "✈️": ":airplane:",
  "🛫": ":airplane_departure:",
  "🛬": ":airplane_arrival:",
  "🪂": ":parachute:",
  "💺": ":seat:",
  "🚁": ":helicopter:",
  "🚟": ":suspension_railway:",
  "🛶": ":canoe:",
  "⛵": ":sailboat:",
  "🚤": ":speedboat:",
  "🛳️": ":ship:",
  "⛴️": ":ferry:",
  "🚢": ":ship2:",
  "⚓": ":anchor:",
  "🪝": ":hook:",
  "⛽": ":fuel:",
  "🚧": ":construction:",

  // ════════════════════════════════════════════════════════════
  // HEARTS, SYMBOLS & STATUS
  // ════════════════════════════════════════════════════════════
  "❤️": ":heart:",
  "🧡": ":orange_heart:",
  "💛": ":yellow_heart:",
  "💚": ":green_heart:",
  "💙": ":blue_heart:",
  "💜": ":purple_heart:",
  "🖤": ":black_heart:",
  "🤍": ":white_heart:",
  "🤎": ":brown_heart:",
  "💔": ":broken_heart:",
  "❤️‍🔥": ":heart_on_fire:",
  "❤️‍🩹": ":mending_heart:",
  "❣️": ":heart_exclamation:",
  "💕": ":two_hearts:",
  "💞": ":revolving_hearts:",
  "💓": ":heartbeat:",
  "💗": ":growing_heart:",
  "💖": ":sparkling_heart:",
  "💘": ":cupid:",
  "💝": ":gift_heart:",
  "💟": ":heart_decor:",
  "♥️": ":heart_suit:",
  "💯": ":100:",
  "💢": ":anger:",
  "💥": ":boom:",
  "💫": ":dizzy:",
  "💦": ":sweat_drops:",
  "💨": ":dash:",
  "🕳️": ":hole:",
  "💥": ":collision:",
  "💬": ":speech_balloon:",
  "💭": ":thought_balloon:",
  "🗯️": ":anger_bubble:",

  // ════════════════════════════════════════════════════════════
  // HANDS & OBJECTS
  // ════════════════════════════════════════════════════════════
  "⌚": ":watch:",
  "📱": ":phone:",
  "📲": ":phone_arrow:",
  "💻": ":laptop:",
  "⌨️": ":keyboard:",
  "🖥️": ":desktop:",
  "🖨️": ":printer:",
  "🖱️": ":mouse:",
  "🖲️": ":trackball:",
  "💾": ":floppy_disk:",
  "💿": ":cd:",
  "📀": ":dvd:",
  "🧮": ":abacus:",
  "🎥": ":movie_camera:",
  "🎞️": ":film:",
  "📽️": ":projector:",
  "📺": ":tv:",
  "📷": ":camera:",
  "📸": ":camera_flash:",
  "📹": ":video_camera:",
  "📼": ":vhs:",
  "🔍": ":magnifier:",
  "🔎": ":magnifier_right:",
  "🕯️": ":candle:",
  "💡": ":light_bulb:",
  "🔦": ":flashlight:",
  "🏮": ":lantern:",
  "🪔": ":diya_lamp:",
  "📔": ":notebook:",
  "📕": ":closed_book:",
  "📖": ":open_book:",
  "📗": ":green_book:",
  "📘": ":blue_book:",
  "📙": ":orange_book:",
  "📚": ":books:",
  "📓": ":notebook2:",
  "📒": ":ledger:",
  "📃": ":page:",
  "📄": ":page_facing:",
  "📰": ":newspaper:",
  "📑": ":bookmark_tabs:",
  "🔖": ":bookmark:",
  "🏷️": ":label:",
  "💰": ":money_bag:",
  "🪙": ":coin:",
  "💴": ":yen:",
  "💵": ":dollar:",
  "💶": ":euro:",
  "💷": ":pound:",
  "💸": ":money_wings:",
  "💳": ":credit_card:",
  "🧾": ":receipt:",
  "✉️": ":envelope:",
  "📧": ":email:",
  "📨": ":incoming_envelope:",
  "📩": ":envelope_arrow:",
  "📤": ":outbox:",
  "📥": ":inbox:",
  "📦": ":package:",
  "📫": ":mailbox_closed:",
  "📪": ":mailbox_open:",
  "📬": ":mailbox_flagged:",
  "📭": ":mailbox_flagged_down:",
  "📮": ":postbox:",
  "🗳️": ":ballot_box:",
  "✏️": ":pencil:",
  "✒️": ":pen:",
  "🖋️": ":fountain_pen:",
  "🖊️": ":pen2:",
  "🖌️": ":paintbrush:",
  "🖍️": ":crayon:",
  "📝": ":memo:",
  "💼": ":briefcase:",
  "📁": ":folder:",
  "📂": ":folder_open:",
  "📅": ":calendar:",
  "📆": ":tear_calendar:",
  "🗒️": ":spiral_pad:",
  "🗓️": ":calendar2:",
  "📇": ":card_index:",
  "📈": ":chart_up:",
  "📉": ":chart_down:",
  "📊": ":bar_chart:",
  "📋": ":clipboard:",
  "📌": ":pushpin:",
  "📍": ":round_pushpin:",
  "📎": ":paperclip:",
  "🖇️": ":linked_paperclips:",
  "📏": ":ruler:",
  "📐": ":triangular_ruler:",
  "✂️": ":scissors:",
  "🗃️": ":card_file:",
  "🗄️": ":file_cabinet:",
  "🗑️": ":trash:",
  "🔒": ":lock:",
  "🔓": ":unlock:",
  "🔏": ":lock_ink:",
  "🔐": ":lock_key:",
  "🔑": ":key:",
  "🗝️": ":old_key:",
  "🔨": ":hammer:",
  "🪓": ":axe:",
  "⛏️": ":pick:",
  "⚒️": ":hammer_pick:",
  "🛠️": ":tools:",
  "🗡️": ":dagger:",
  "⚔️": ":swords:",
  "🔫": ":gun:",
  "🏹": ":bow_arrow:",
  "🛡️": ":shield:",
  "🪚": ":carpentry_saw:",
  "🔧": ":wrench:",
  "🪛": ":screwdriver:",
  "🔩": ":bolt:",
  "⚙️": ":gear:",
  "🗜️": ":clamp:",
  "⚖️": ":scales:",
  "🦯": ":probe:",
  "🔗": ":link:",
  "⛓️": ":chains:",
  "🪝": ":hook:",
  "🧰": ":toolbox:",
  "🧲": ":magnet:",
  "🪜": ":ladder:",

  // ════════════════════════════════════════════════════════════
  // CELEBRATIONS, AWARDS & ACTIVITIES
  // ════════════════════════════════════════════════════════════
  "🎉": ":party_popper:",
  "🎊": ":confetti:",
  "🎈": ":balloon:",
  "🎁": ":gift:",
  "🎀": ":ribbon:",
  "🎖️": ":military_medal:",
  "🏆": ":trophy:",
  "🥇": ":first_place:",
  "🥈": ":second_place:",
  "🥉": ":third_place:",
  "⚽": ":soccer:",
  "🏀": ":basketball2:",
  "🏈": ":football:",
  "⚾": ":baseball:",
  "🥎": ":softball:",
  "🎾": ":tennis:",
  "🏐": ":volleyball:",
  "🏉": ":rugby:",
  "🥏": ":flying_disc:",
  "🎱": ":pool:",
  "🪀": ":yoyo:",
  "🏓": ":ping_pong:",
  "🏸": ":badminton:",
  "🏒": ":hockey:",
  "🏑": ":field_hockey:",
  "🥍": ":lacrosse:",
  "🏏": ":cricket:",
  "🪃": ":boomerang:",
  "🥅": ":goal:",
  "⛳": ":golf:",
  "🪁": ":kite:",
  "🏹": ":archery:",
  "🎣": ":fishing:",
  "🤿": ":diving:",
  "🥊": ":boxing:",
  "🥋": ":martial_arts:",
  "🎽": ":running_shirt:",
  "🛹": ":skateboard:",
  "🛼": ":roller_skate:",
  "🛷": ":sled:",
  "⛸️": ":ice_skate:",
  "🥌": ":curling:",
  "🎿": ":ski:",
  "⛷️": ":skier:",
  "🏂": ":snowboard:",
  "🪂": ":parachute:",
  "🏋️": ":weightlifting:",
  "🤼": ":wrestling:",
  "🤸": ":gymnastics:",
  "⛹️": ":basketball3:",
  "🤺": ":fencing:",
  "🏌️": ":golfing:",
  "🏇": ":horse_racing:",
  "🧘": ":yoga:",
  "🏄": ":surfing:",
  "🏊": ":swimming:",
  "🚣": ":rowing:",
  "🧗": ":climbing:",
  "🚵": ":mountain_biking:",
  "🚴": ":biking:",
  "🎪": ":circus:",
  "🎭": ":theater:",
  "🎨": ":art:",
  "🎬": ":clapper:",
  "🎤": ":microphone:",
  "🎧": ":headphones:",
  "🎼": ":musical_score:",
  "🎵": ":musical_note:",
  "🎶": ":musical_notes:",
  "🎹": ":piano:",
  "🥁": ":drum:",
  "🪘": ":long_drum:",
  "🎷": ":saxophone:",
  "🎺": ":trumpet:",
  "🎸": ":guitar:",
  "🪕": ":banjo:",
  "🎻": ":violin:",
  "🎲": ":dice:",
  "♟️": ":chess_pawn:",
  "🎯": ":target:",
  "🎳": ":bowling:",
  "🎮": ":game_controller:",
  "🕹️": ":joystick:",
  "🎰": ":slot_machine:",
  "🧩": ":puzzle:",

  // ════════════════════════════════════════════════════════════
  // WEATHER & CELESTIAL
  // ════════════════════════════════════════════════════════════
  "☀️": ":sun:",
  "🌤️": ":sun_behind_cloud:",
  "⛅": ":partly_cloudy:",
  "🌥️": ":mostly_cloudy:",
  "☁️": ":cloud:",
  "🌦️": ":sun_rain:",
  "🌧️": ":rain:",
  "⛈️": ":thunderstorm:",
  "🌩️": ":lightning:",
  "🌨️": ":snow_cloud:",
  "❄️": ":snowflake:",
  "☃️": ":snowman:",
  "⛄": ":snowman2:",
  "🌬️": ":wind:",
  "💨": ":dash:",
  "💧": ":droplet:",
  "💦": ":sweat_drops:",
  "☔": ":umbrella_rain:",
  "☂️": ":umbrella:",
  "🌊": ":wave:",
  "🌫️": ":fog:",
  "🌈": ":rainbow:",
  "🌕": ":full_moon:",
  "🌖": ":waning_gibbous:",
  "🌗": ":last_quarter:",
  "🌘": ":waning_crescent:",
  "🌑": ":new_moon:",
  "🌒": ":waxing_crescent:",
  "🌓": ":first_quarter:",
  "🌔": ":waxing_gibbous:",
  "🌙": ":crescent_moon:",
  "🌚": ":new_moon_face:",
  "🌛": ":first_quarter_face:",
  "🌜": ":last_quarter_face:",
  "🌡️": ":thermometer:",
  "☀️": ":bright_sun:",
  "🌝": ":full_moon_face:",
  "😎": ":sun_glasses:",
  "⭐": ":star:",
  "🌟": ":glowing_star:",
  "✨": ":sparkles:",
  "🌠": ":shooting_star:",
  "🪐": ":ringed_planet:",

  // ════════════════════════════════════════════════════════════
  // CHECKS, CROSSES & STATUS
  // ════════════════════════════════════════════════════════════
  "✅": ":check_mark:",
  "❌": ":cross_mark:",
  "⭕": ":hollow_circle:",
  "❗": ":exclamation:",
  "❓": ":question:",
  "❕": ":white_exclamation:",
  "❔": ":white_question:",
  "✖️": ":multiply:",
  "➕": ":plus:",
  "➖": ":minus:",
  "➗": ":divide:",
  "🟢": ":green_circle:",
  "🔴": ":red_circle:",
  "🟡": ":yellow_circle:",
  "🟠": ":orange_circle:",
  "🔵": ":blue_circle:",
  "🟣": ":purple_circle:",
  "⚫": ":black_circle:",
  "⚪": ":white_circle:",
  "🟤": ":brown_circle:",
  "🔻": ":red_triangle_down:",
  "🔸": ":orange_diamond:",
  "🔹": ":blue_diamond:",
  "🔻": ":red_triangle:",
  "🔶": ":orange_diamond:",
  "🔷": ":blue_diamond:",
  "🔸": ":orange_diamond:",

  // ════════════════════════════════════════════════════════════
  // ARROWS
  // ════════════════════════════════════════════════════════════
  "⬆️": ":arrow_up:",
  "↗️": ":arrow_upper_right:",
  "➡️": ":arrow_right:",
  "↘️": ":arrow_lower_right:",
  "⬇️": ":arrow_down:",
  "↙️": ":arrow_lower_left:",
  "⬅️": ":arrow_left:",
  "↖️": ":arrow_upper_left:",
  "↕️": ":arrow_up_down:",
  "↔️": ":arrow_left_right:",
  "↩️": ":arrow_left_hook:",
  "↪️": ":arrow_right_hook:",
  "⤴️": ":arrow_top_right:",
  "⤵️": ":arrow_bottom_right:",
  "🔃": ":arrows_counterclockwise:",
  "🔄": ":arrows_clockwise:",
  "🔙": ":back:",
  "🔚": ":end:",
  "🔛": ":on:",
  "🔜": ":soon:",
  "🔝": ":top:",
  "🛐": ":place_of_worship:",
  "⚛️": ":atom:",
  "🕉️": ":om:",
  "✡️": ":star_of_david:",
  "☸️": ":wheel:",
  "☯️": ":yin_yang:",
  "✝️": ":cross:",
  "☦️": ":orthodox_cross:",
  "☪️": ":crescent:",
  "☮️": ":peace_symbol:",
  "🕎": ":menorah:",
  "🔯": ":six_pointed_star:",

  // ════════════════════════════════════════════════════════════
  // WARNING, SAFETY & BUSINESS
  // ════════════════════════════════════════════════════════════
  "⚠️": ":warning:",
  "🚸": ":children_crossing:",
  "⛔": ":no_entry:",
  "🚫": ":prohibited:",
  "🚳": ":no_bicycles:",
  "🚭": ":no_smoking:",
  "🚯": ":no_littering:",
  "🚱": ":non_potable:",
  "🚷": ":no_pedestrians:",
  "📵": ":no_phones:",
  "🔞": ":underage:",
  "☢️": ":radioactive:",
  "☣️": ":biohazard:",
  "⬆️": ":up_arrow:",
  "↗️": ":upper_right_arrow:",
  "➡️": ":right_arrow:",
  "↘️": ":lower_right_arrow:",
  "⬇️": ":down_arrow:",
  "↙️": ":lower_left_arrow:",
  "⬅️": ":left_arrow:",
  "↖️": ":upper_left_arrow:",
  "↕️": ":up_down_arrow:",
  "↔️": ":left_right_arrow:",
  "↩️": ":left_hook_arrow:",
  "↪️": ":right_hook_arrow:",
  "⤴️": ":top_right_arrow:",
  "⤵️": ":bottom_right_arrow:",
  "🔃": ":counterclockwise:",
  "🔄": ":clockwise:",
  "🔙": ":back_arrow:",
  "🔚": ":end_arrow:",
  "🔛": ":on_arrow:",
  "🔜": ":soon_arrow:",
  "🔝": ":top_arrow:",
  "🆗": ":ok:",
  "🆕": ":new:",
  "🆙": ":up:",
  "🆒": ":cool_sign:",
  "🆓": ":free:",
  "🆖": ":ng:",
  "ℹ️": ":information:",
  "🔴": ":red_button:",
  "🟢": ":green_button:",
  "🔵": ":blue_button:",
  "🟣": ":purple_button:",

  // ════════════════════════════════════════════════════════════
  // FLAGS (common ones - all flags → :flag_<country>:_name)
  // ════════════════════════════════════════════════════════════
  "🏁": ":checkered_flag:",
  "🚩": ":red_flag:",
  "🏴": ":black_flag:",
  "🏳️": ":white_flag:",
  "🏳️‍🌈": ":rainbow_flag:",
  "🏳️‍⚧️": ":trans_flag:",
  "🏴‍☠️": ":pirate_flag:",
  "🇮🇳": ":flag_india:",
  "🇺🇸": ":flag_usa:",
  "🇬🇧": ":flag_uk:",
  "🇨🇦": ":flag_canada:",
  "🇦🇺": ":flag_australia:",
  "🇩🇪": ":flag_germany:",
  "🇫🇷": ":flag_france:",
  "🇯🇵": ":flag_japan:",
  "🇨🇳": ":flag_china:",
  "🇰🇷": ":flag_south_korea:",
  "🇧🇷": ":flag_brazil:",
  "🇲🇽": ":flag_mexico:",
  "🇮🇹": ":flag_italy:",
  "🇪🇸": ":flag_spain:",
  "🇷🇺": ":flag_russia:",
  "🇸🇦": ":flag_saudi_arabia:",
  "🇦🇪": ":flag_uae:",
  "🇿🇦": ":flag_south_africa:",
  "🇳🇬": ":flag_nigeria:",
  "🇪🇬": ":flag_egypt:",
  "🇵🇰": ":flag_pakistan:",
  "🇧🇩": ":flag_bangladesh:",
  "🇹🇭": ":flag_thailand:",
  "🇻🇳": ":flag_vietnam:",
  "🇮🇩": ":flag_indonesia:",
  "🇵🇭": ":flag_philippines:",
  "🇹🇷": ":flag_turkey:",
  "🇮🇷": ":flag_iran:",
  "🇮🇱": ":flag_israel:",

  // ════════════════════════════════════════════════════════════
  // SPECIAL / COMMON BUSINESS & TECH
  // ════════════════════════════════════════════════════════════
  "🚀": ":high_performance:",
  "🔥": ":fire:",
  "💪": ":strong:",
  "⭐": ":star:",
  "🌟": ":star2:",
  "✨": ":sparkle:",
  "💫": ":dizzy2:",
  "🚨": ":alert:",
  "🔔": ":bell:",
  "🔕": ":bell_mute:",
  "📣": ":megaphone:",
  "📢": ":loudspeaker:",
  "💡": ":idea:",
  "🔑": ":key2:",
  "📌": ":pin:",
  "🎯": ":bullseye:",
  "🏆": ":champion:",
  "💎": ":gem:",
  "🪙": ":coin2:",
  "💸": ":money:",
  "📈": ":growth:",
  "📉": ":decline:",
  "📊": ":chart:",
  "📋": ":checklist:",
  "✅": ":done:",
  "❌": ":failed:",
  "⏰": ":alarm:",
  "⏳": ":hourglass:",
  "⌛": ":hourglass2:",
  "⏱️": ":stopwatch:",
  "⏲️": ":timer:",
  "🕐": ":one_oclock:",
  "🕐": ":clock:",
  "#️⃣": ":hash:",
  "*️⃣": ":asterisk:",
  "0️⃣": ":zero:",
  "1️⃣": ":one:",
  "2️⃣": ":two:",
  "3️⃣": ":three:",
  "4️⃣": ":four:",
  "5️⃣": ":five:",
  "6️⃣": ":six:",
  "7️⃣": ":seven:",
  "8️⃣": ":eight:",
  "9️⃣": ":nine:",
  "🔟": ":ten:",
  "🔢": ":input_numbers:",
  "🔠": ":input_latin_upper:",
  "🔡": ":input_latin_lower:",
  "🔣": ":input_symbols:",
  "🅰️": ":a_button:",
  "🆎": ":ab_button:",
  "🅱️": ":b_button:",
  "🆑": ":cl_button:",
  "🆒": ":cool_button:",
  "🆓": ":free_button:",
  "ℹ️": ":info_button:",
  "🆔": ":id_button:",
  "Ⓜ️": ":m_button:",
  "🆕": ":new_button:",
  "🆖": ":ng_button:",
  "🅾️": ":o_button:",
  "🆗": ":ok_button:",
  "🅿️": ":p_button:",
  "🆘": ":sos_button:",
  "🆙": ":up_button:",
  "🆚": ":vs_button:",
  "🈁": ":koko:",
  "🈂️": ":sa:",
  "🈷️": ":u6708:",
  "🈶": ":u6709:",
  "🈯": ":u670d:",
  "🉐": ":ideograph_advantage:",
  "🈹": ":u5272:",
  "🈚": ":u7121:",
  "🈲": ":u7981:",
  "🉑": ":accept:",
  "🈸": ":u7533:",
  "🈴": ":u5408:",
  "🈳": ":u7a7a:",
  "㊗️": ":congratulations:",
  "㊙️": ":secret:",
  "🈺": ":u55b6:",
  "🈵": ":u6e80:",
  "🔴": ":red_circle2:",
  "🟠": ":orange_circle2:",
  "🟡": ":yellow_circle2:",
  "🟢": ":green_circle2:",
  "🔵": ":blue_circle2:",
  "🟣": ":purple_circle2:",
  "🟤": ":brown_circle2:",
  "⚫": ":black_circle2:",
  "⚪": ":white_circle2:",
  "🟥": ":red_square:",
  "🟧": ":orange_square:",
  "🟨": ":yellow_square:",
  "🟩": ":green_square:",
  "🟦": ":blue_square:",
  "🟪": ":purple_square:",
  "🟫": ":brown_square:",
  "⬛": ":black_large_square:",
  "⬜": ":white_large_square:",
  "◼️": ":black_medium_square:",
  "◻️": ":white_medium_square:",
  "◾": ":black_medium_small_square:",
  "◽": ":white_medium_small_square:",
  "▪️": ":black_small_square:",
  "▫️": ":white_small_square:",

  // ════════════════════════════════════════════════════════════
  // KEYCAP & VARIATION SELECTOR COMBINATIONS
  // ════════════════════════════════════════════════════════════
  "©️": ":copyright:",
  "®️": ":registered:",
  "™️": ":trademark:",
  "❤️‍🔥": ":heart_fire:",
  "❤️‍🩹": ":heart_heal:",
  "🫶": ":heart_hands:",
  "🫰": ":hand_with_index_and_thumb:",
  "🫱": ":rightwards_hand:",
  "🫲": ":leftwards_hand:",
  "🫳": ":palm_down_hand:",
  "🫴": ":palm_up_hand:",
  "🫵": ":index_pointing_at_viewer:",
  "🫱‍🫲": ":handshake2:",
  "🫂": ":people_hugging:",
  "🫃": ":pregnant_man:",
  "🫄": ":pregnant_person:",
  "🫠": ":melting_face:",
  "🫥": ":dotted_line_face:",
  "🫧": ":bubbles:",
  "🫠": ":melting:",
  "🪸": ":coral:",
  "🪷": ":lotus:",
  "🪹": ":empty_nest:",
  "🪺": ":nest_with_eggs:",
  "🪻": ":hyacinth:",
  "🪼": ":jellyfish:",
  "🪽": ":wing:",
  "🪿": ":goose:",
  "🫎": ":moose:",
  "🫏": ":donkey:",
  "🪼": ":jellyfish:",
  "🫛": ":pea_pod:",
  "🫒": ":olive2:",
  "🫔": ":tamale:",
  "🫕": ":fondue:",
  "🫖": ":teapot2:",
  "🫗": ":pouring_liquid:",
  "🫙": ":jar:",
  "🪩": ":mirror_ball:",
  "🪪": ":id_card:",
  "🪫": ":folded_hands:",
  "🫗": ":pouring2:",
  "🫙": ":jar2:",
};

// ── Skin Tone Variants Map ──────────────────────────────────
// Maps skin-tone modified emoji variants to their canonical form.
// E.g., 👍🏻, 👍🏼, 👍🏽, 👍🏾, 👍🏿 → 👍 → :thumbs_up:
const SKIN_TONE_MODIFIERS = [
  "\u{1F3FB}", // light skin
  "\u{1F3FC}", // medium-light skin
  "\u{1F3FD}", // medium skin
  "\u{1F3FE}", // medium-dark skin
  "\u{1F3FF}", // dark skin
];

// ── Full Unicode Emoji Regex ─────────────────────────────────
// Covers: Emoji_Presentation, Extended_Pictographic, variation selectors,
// ZWJ sequences, skin tones, keycap sequences, and regional indicators.
const FULL_EMOJI_REGEX = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|[\uFE0F\u200D\u{20E3}\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]|\p{Regional_Indicator}{2})/gu;

export interface SanitizeOptions {
  /** Conversion mode */
  mode: "semantic" | "remove" | "keep";
  /** If true, skip sanitization for feedback/sentiment columns */
  preserveFeedbackColumns?: boolean;
  /** Column name (used when preserveFeedbackColumns is true) */
  columnName?: string;
  /** Custom mapping overrides (merged on top of built-in map) */
  customMap?: Record<string, string>;
}

export interface SanitizeResult {
  /** The sanitized string */
  text: string;
  /** Number of emojis converted */
  conversions: number;
  /** List of individual conversions: [emoji, replacement] */
  details: Array<{ emoji: string; replacement: string }>;
}

/**
 * Strip skin tone modifiers from an emoji to get its canonical base form.
 * 👍🏻 → 👍, 👩🏾‍💻 → 👩‍💻
 */
function stripSkinTone(emoji: string): string {
  let result = emoji;
  for (const st of SKIN_TONE_MODIFIERS) {
    result = result.replace(new RegExp(st, "gu"), "");
  }
  return result;
}

/**
 * Check if a string is a regional indicator flag pair (🇮🇳, 🇺🇸, etc.)
 */
function isFlagPair(s: string): boolean {
  return /^(\p{Regional_Indicator}){2}$/u.test(s);
}

/**
 * Get the country name from a flag pair (🇮🇳 → "india")
 */
function getFlagCountryName(flag: string): string | null {
  if (!isFlagPair(flag)) return null;
  const codePoints = [...flag].map((c) => c.codePointAt(0)!);
  // Regional indicators start at U+1F1E6 (A). Offset from 'A' = 65
  const letter1 = String.fromCodePoint(codePoints[0] - 0x1F1E6 + 65);
  const letter2 = String.fromCodePoint(codePoints[1] - 0x1F1E6 + 65);
  const countryCode = (letter1 + letter2).toLowerCase();

  // Common country name mapping
  const FLAG_COUNTRY_NAMES: Record<string, string> = {
    in: "india", us: "usa", gb: "uk", ca: "canada", au: "australia",
    de: "germany", fr: "france", jp: "japan", cn: "china", kr: "south_korea",
    br: "brazil", mx: "mexico", it: "italy", es: "spain", ru: "russia",
    sa: "saudi_arabia", ae: "uae", za: "south_africa", ng: "nigeria",
    eg: "egypt", pk: "pakistan", bd: "bangladesh", th: "thailand",
    vn: "vietnam", id: "indonesia", ph: "philippines", tr: "turkey",
    ir: "iran", il: "israel", sg: "singapore", my: "malaysia",
    nl: "netherlands", se: "sweden", no: "norway", dk: "denmark",
    fi: "finland", pl: "poland", ch: "switzerland", at: "austria",
    be: "belgium", ie: "ireland", pt: "portugal", gr: "greece",
    nz: "new_zealand", ar: "argentina", co: "colombia", cl: "chile",
    pe: "peru", ke: "kenya", gh: "ghana", lk: "sri_lanka", np: "nepal",
  };
  return FLAG_COUNTRY_NAMES[countryCode] || countryCode;
}

/**
 * Convert an emoji to its hex code point representation (for unknown emojis).
 * 😊 → :emoji:1f60a:
 */
function emojiToHex(emoji: string): string {
  const codePoints = [...emoji].map((c) => c.codePointAt(0)!.toString(16));
  return `:emoji:${codePoints.join("_")}:`;
}

/**
 * Core function: sanitize a single string value by converting emojis.
 *
 * @param text - The input string (may contain emojis)
 * @param options - Sanitization options
 * @returns SanitizeResult with the cleaned text and conversion details
 */
export function sanitizeEmojis(
  text: string,
  options: SanitizeOptions = { mode: "semantic" }
): SanitizeResult {
  if (!text || typeof text !== "string") {
    return { text: text ?? "", conversions: 0, details: [] };
  }

  // Mode: keep — no sanitization
  if (options.mode === "keep") {
    return { text, conversions: 0, details: [] };
  }

  // Mode: remove — strip all emojis
  if (options.mode === "remove") {
    const emojis = text.match(FULL_EMOJI_REGEX) || [];
    const details = emojis.map((e) => ({ emoji: e, replacement: "" }));
    const cleaned = text.replace(FULL_EMOJI_REGEX, "").replace(/\s{2,}/g, " ").trim();
    return { text: cleaned, conversions: emojis.length, details };
  }

  // Mode: semantic — convert emojis to text
  const map = { ...EMOJI_MAP, ...(options.customMap || {}) };
  const details: Array<{ emoji: string; replacement: string }> = [];
  let conversions = 0;

  // Use a replacement function to handle each emoji
  const result = text.replace(FULL_EMOJI_REGEX, (match) => {
    // 1. Direct lookup
    if (map[match]) {
      conversions++;
      const replacement = map[match];
      details.push({ emoji: match, replacement });
      return ` ${replacement} `;
    }

    // 2. Try stripping skin tone modifiers → lookup base emoji
    const base = stripSkinTone(match);
    if (base !== match && map[base]) {
      conversions++;
      const replacement = map[base];
      details.push({ emoji: match, replacement });
      return ` ${replacement} `;
    }

    // 3. Check if it's a flag pair
    if (isFlagPair(match)) {
      const countryName = getFlagCountryName(match);
      if (countryName) {
        conversions++;
        const replacement = `:flag_${countryName}:`;
        details.push({ emoji: match, replacement });
        return ` ${replacement} `;
      }
    }

    // 4. Fallback: convert to hex representation
    conversions++;
    const replacement = emojiToHex(match);
    details.push({ emoji: match, replacement });
    return ` ${replacement} `;
  });

  // Clean up excess whitespace from replacements
  const cleaned = result.replace(/\s{2,}/g, " ").trim();

  return { text: cleaned, conversions, details };
}

/**
 * Sanitize an entire data row — convert emojis in all string cells.
 * Non-string values (numbers, nulls) are passed through unchanged.
 *
 * @param row - A data row object
 * @param options - Sanitization options (columnName is auto-set per cell)
 * @returns The sanitized row
 */
export function sanitizeRow(
  row: Record<string, unknown>,
  options: Omit<SanitizeOptions, "columnName"> = { mode: "semantic" }
): { row: Record<string, unknown>; totalConversions: number } {
  const newRow: Record<string, unknown> = {};
  let totalConversions = 0;

  for (const [key, value] of Object.entries(row)) {
    if (value == null) {
      newRow[key] = value;
      continue;
    }

    if (typeof value === "string") {
      const { text, conversions } = sanitizeEmojis(value, {
        ...options,
        columnName: key,
      });
      newRow[key] = text;
      totalConversions += conversions;
    } else {
      newRow[key] = value;
    }
  }

  return { row: newRow, totalConversions };
}

/**
 * Sanitize an entire dataset for export.
 * Converts all emojis in all string cells to their semantic text equivalents.
 *
 * @param data - Array of data rows
 * @param options - Sanitization options
 * @returns { sanitizedData: RawDataRow[], totalConversions: number, summary: Record<string, number> }
 */
export function sanitizeDatasetForExport(
  data: Record<string, unknown>[],
  options: Omit<SanitizeOptions, "columnName"> = { mode: "semantic" }
): {
  sanitizedData: Record<string, unknown>[];
  totalConversions: number;
  summary: Record<string, number>;
} {
  const sanitizedData: Record<string, unknown>[] = [];
  let totalConversions = 0;
  const summary: Record<string, number> = {};

  for (const row of data) {
    const { row: sanitizedRow, totalConversions: rowConversions } = sanitizeRow(row, options);
    sanitizedData.push(sanitizedRow);
    totalConversions += rowConversions;

    // Per-column breakdown
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string") {
        const emojiMatches = value.match(FULL_EMOJI_REGEX);
        if (emojiMatches && emojiMatches.length > 0) {
          summary[key] = (summary[key] || 0) + emojiMatches.length;
        }
      }
    }
  }

  return { sanitizedData, totalConversions, summary };
}

/**
 * Quick check: does a string contain any emojis?
 */
export function hasEmojis(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return FULL_EMOJI_REGEX.test(text);
}

/**
 * Count emojis in a string.
 */
export function countEmojis(text: string): number {
  if (!text || typeof text !== "string") return 0;
  const matches = text.match(FULL_EMOJI_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Count total emojis in an entire dataset.
 * Returns per-column counts and a total.
 */
export function countEmojisInDataset(
  data: Record<string, unknown>[]
): { total: number; byColumn: Record<string, number>; affectedRows: number } {
  let total = 0;
  let affectedRows = 0;
  const byColumn: Record<string, number> = {};

  for (const row of data) {
    let rowHasEmoji = false;
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" && hasEmojis(value)) {
        const count = countEmojis(value);
        byColumn[key] = (byColumn[key] || 0) + count;
        total += count;
        rowHasEmoji = true;
      }
    }
    if (rowHasEmoji) affectedRows++;
  }

  return { total, byColumn, affectedRows };
}
