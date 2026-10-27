//! Begriffe, die die KI auf Fotos erkennen kann (englisch für das Modell, deutsch zum Anzeigen).
//! Dient dazu, dem Sprachmodell zu sagen, was auf einem Foto zu sehen ist, und für "Was ist auf dem Foto?".

pub const LABELS: &[(&str, &str)] = &[
    // Natur & Landschaft
    ("forest", "Wald"), ("trees", "Bäume"), ("meadow", "Wiese"), ("field", "Feld"), ("mountains", "Berge"),
    ("snowy mountains", "verschneite Berge"), ("hills", "Hügel"), ("lake", "See"), ("river", "Fluss"), ("waterfall", "Wasserfall"),
    ("sea", "Meer"), ("beach", "Strand"), ("coast", "Küste"), ("island", "Insel"), ("desert", "Wüste"),
    ("canyon", "Schlucht"), ("cave", "Höhle"), ("garden", "Garten"), ("park", "Park"), ("flowers", "Blumen"),
    ("sunflowers", "Sonnenblumen"), ("tulips", "Tulpen"), ("roses", "Rosen"), ("autumn leaves", "Herbstlaub"), ("palm trees", "Palmen"),
    ("sunset", "Sonnenuntergang"), ("sunrise", "Sonnenaufgang"), ("night sky", "Nachthimmel"), ("stars", "Sterne"), ("moon", "Mond"),
    ("clouds", "Wolken"), ("rainbow", "Regenbogen"), ("snow", "Schnee"), ("rain", "Regen"), ("fog", "Nebel"),
    ("thunderstorm", "Gewitter"), ("ice", "Eis"), ("volcano", "Vulkan"),
    // Orte & Gebäude
    ("city", "Stadt"), ("street", "Straße"), ("skyscrapers", "Hochhäuser"), ("old town", "Altstadt"), ("village", "Dorf"),
    ("house", "Haus"), ("church", "Kirche"), ("castle", "Burg"), ("bridge", "Brücke"), ("tower", "Turm"),
    ("harbor", "Hafen"), ("airport", "Flughafen"), ("train station", "Bahnhof"), ("market", "Markt"), ("shop", "Geschäft"),
    ("restaurant", "Restaurant"), ("cafe", "Café"), ("hotel room", "Hotelzimmer"), ("living room", "Wohnzimmer"), ("kitchen", "Küche"),
    ("bedroom", "Schlafzimmer"), ("bathroom", "Badezimmer"), ("office", "Büro"), ("classroom", "Klassenzimmer"), ("museum", "Museum"),
    ("stadium", "Stadion"), ("swimming pool", "Schwimmbad"), ("playground", "Spielplatz"), ("amusement park", "Freizeitpark"), ("zoo", "Zoo"),
    ("campsite", "Campingplatz"), ("tent", "Zelt"), ("ski slope", "Skipiste"), ("concert", "Konzert"), ("stage", "Bühne"),
    // Menschen & Anlässe
    ("person", "Person"), ("group of people", "Gruppe von Menschen"), ("crowd", "Menschenmenge"), ("child", "Kind"), ("baby", "Baby"),
    ("selfie", "Selfie"), ("portrait", "Porträt"), ("family", "Familie"), ("couple", "Paar"), ("wedding", "Hochzeit"),
    ("birthday party", "Geburtstagsfeier"), ("birthday cake", "Geburtstagskuchen"), ("christmas", "Weihnachten"), ("christmas tree", "Weihnachtsbaum"), ("easter eggs", "Ostereier"),
    ("party", "Party"), ("fireworks", "Feuerwerk"), ("graduation", "Abschlussfeier"), ("sports", "Sport"), ("football", "Fußball"),
    ("cycling", "Radfahren"), ("hiking", "Wandern"), ("skiing", "Skifahren"), ("swimming", "Schwimmen"), ("surfing", "Surfen"),
    ("parachute", "Fallschirm"), ("paraglider", "Gleitschirm"), ("hot air balloon", "Heißluftballon"), ("dancing", "Tanzen"), ("music instrument", "Musikinstrument"),
    // Tiere
    ("dog", "Hund"), ("cat", "Katze"), ("horse", "Pferd"), ("cow", "Kuh"), ("sheep", "Schaf"),
    ("pig", "Schwein"), ("chicken", "Huhn"), ("bird", "Vogel"), ("duck", "Ente"), ("swan", "Schwan"),
    ("fish", "Fisch"), ("butterfly", "Schmetterling"), ("bee", "Biene"), ("spider", "Spinne"), ("rabbit", "Hase"),
    ("hamster", "Hamster"), ("guinea pig", "Meerschweinchen"), ("deer", "Reh"), ("fox", "Fuchs"), ("squirrel", "Eichhörnchen"),
    ("elephant", "Elefant"), ("lion", "Löwe"), ("giraffe", "Giraffe"), ("monkey", "Affe"), ("bear", "Bär"),
    ("penguin", "Pinguin"), ("dolphin", "Delfin"), ("insect", "Insekt"),
    // Essen
    ("food", "Essen"), ("pizza", "Pizza"), ("pasta", "Nudeln"), ("burger", "Burger"), ("salad", "Salat"),
    ("cake", "Kuchen"), ("ice cream", "Eis (zum Essen)"), ("breakfast", "Frühstück"), ("bread", "Brot"), ("fruit", "Obst"),
    ("vegetables", "Gemüse"), ("drinks", "Getränke"), ("coffee", "Kaffee"), ("wine", "Wein"), ("barbecue", "Grillen"),
    // Fahrzeuge & Dinge
    ("car", "Auto"), ("motorcycle", "Motorrad"), ("bicycle", "Fahrrad"), ("bus", "Bus"), ("train", "Zug"),
    ("airplane", "Flugzeug"), ("airplane window view", "Blick aus dem Flugzeugfenster"), ("boat", "Boot"), ("sailing boat", "Segelboot"), ("ship", "Schiff"),
    ("tractor", "Traktor"), ("truck", "Lastwagen"), ("computer", "Computer"), ("smartphone", "Handy"), ("television", "Fernseher"),
    ("toys", "Spielzeug"), ("lego", "Lego"), ("book", "Buch"), ("painting", "Gemälde"), ("statue", "Statue"),
    ("clothes", "Kleidung"), ("shoes", "Schuhe"), ("furniture", "Möbel"), ("christmas lights", "Lichterkette"), ("candles", "Kerzen"),
    // Bildarten
    ("screenshot", "Screenshot"), ("document", "Dokument"), ("receipt", "Kassenzettel"), ("handwritten note", "handschriftliche Notiz"), ("whiteboard", "Tafel/Whiteboard"),
    ("map", "Karte"), ("meme", "Meme"), ("text", "Text"), ("drawing", "Zeichnung"), ("blurry photo", "unscharfes Foto"),
    ("dark photo", "dunkles Foto"), ("black and white photo", "Schwarz-Weiß-Foto"), ("close-up", "Nahaufnahme"), ("aerial view", "Luftaufnahme"), ("underwater", "Unterwasser"),
];
