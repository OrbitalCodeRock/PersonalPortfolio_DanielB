// Real images for the sky view, loaded only when the telescope zooms in (see cosmos.ts).
// Downloaded from Wikimedia Commons, resized; each entry keeps its author, license and
// source page for the credits. Planet maps are Solar System Scope textures (CC BY 4.0).
// Deep-sky keys are the catalog designations in deepSky.ts; comet keys are the ids in comets.ts.

export interface ImageCredit {
	artist: string;
	license: string;
	source: string;
}

export const planetMaps: Record<string, ImageCredit & { map: string }> = {
	"Moon": {
		"map": "/sky/planets/moon.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_moon.jpg"
	},
	"Mercury": {
		"map": "/sky/planets/mercury.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_mercury.jpg"
	},
	"Venus": {
		"map": "/sky/planets/venus.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_venus_atmosphere.jpg"
	},
	"Mars": {
		"map": "/sky/planets/mars.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_mars.jpg"
	},
	"Jupiter": {
		"map": "/sky/planets/jupiter.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_jupiter.jpg"
	},
	"Saturn": {
		"map": "/sky/planets/saturn.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_saturn.jpg"
	},
	"Uranus": {
		"map": "/sky/planets/uranus.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_uranus.jpg"
	},
	"Neptune": {
		"map": "/sky/planets/neptune.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_neptune.jpg"
	},
	"Pluto": {
		"map": "/sky/planets/pluto.jpg",
		"artist": "NASA / Johns Hopkins University Applied Physics Laboratory / Southwest Research Institute (unimaged far south filled in)",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Pluto_color_mapmosaic.jpg"
	},
	"Ceres": {
		"map": "/sky/planets/ceres.jpg",
		"artist": "NASA/JPL-Caltech/UCLA/MPS/DLR/IDA (true-color band only)",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:PIA20354-Ceres-DwarfPlanet-MercatorMap-HAMO-20160322-0DegreeLongitude.jpg"
	},
	"Vesta": {
		"map": "/sky/planets/vesta.jpg",
		"artist": "NASA/JPL-Caltech/UCLA/MPS/DLR/IDA",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Vesta_map_for_GeoHack.png"
	},
	"Europa": {
		"map": "/sky/planets/europa.jpg",
		"artist": "U.S. Geological Survey / Planetary Data System / Tammy Becker",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Europa_Voyager_GalileoSSI_global_mosaic.jpg"
	},
	"Ganymede": {
		"map": "/sky/planets/ganymede.jpg",
		"artist": "Caltech/JPL/USGS",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Ganymede_map_NASA_JPL_Voyager.jpg"
	},
	"Callisto": {
		"map": "/sky/planets/callisto.jpg",
		"artist": "USGS Astrogeology Science Center",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Callisto_USGS_global_small.jpg"
	},
	"Sun": {
		"map": "/sky/planets/sun.jpg",
		"artist": "Solar System Scope",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_sun.jpg"
	}
};

export const deepSkyImages: Record<string, ImageCredit & { small: string; large: string }> = {
	"M31": {
		"small": "/sky/deep/m31-512.jpg",
		"large": "/sky/deep/m31-1280.jpg",
		"artist": "Lviatour",
		"license": "CC BY-SA 2.5",
		"source": "https://commons.wikimedia.org/wiki/File:M31-Andromede-16-09-2023-Hamois.jpg"
	},
	"M33": {
		"small": "/sky/deep/m33-512.jpg",
		"large": "/sky/deep/m33-1280.jpg",
		"artist": "ESO",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:VST_snaps_a_very_detailed_view_of_the_Triangulum_Galaxy.jpg"
	},
	"M51": {
		"small": "/sky/deep/m51-512.jpg",
		"large": "/sky/deep/m51-1280.jpg",
		"artist": "NASA and European Space Agency",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Messier51_sRGB.jpg"
	},
	"M101": {
		"small": "/sky/deep/m101-512.jpg",
		"large": "/sky/deep/m101-1280.jpg",
		"artist": "European Space Agency & NASA Acknowledgements: Project Investigators for the original Hubble data: K.D. Kuntz (GSFC), F. Bresolin (University of Hawaii), J. Trauger (JPL), J. Mould (NOAO), and Y.-H. Chu (University of Illinois, Urbana) Image processing: Davide De Martin (ESA/Hubble) CFHT image: Canada-France-Hawaii Telescope/J.-C. Cuillandre/Coelum NOAO image: George Jacoby, Bruce Bohannan, Mark Hanna/NOAO/AURA/NSF",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:M101_hires_STScI-PRC2006-10a.jpg"
	},
	"M81": {
		"small": "/sky/deep/m81-512.jpg",
		"large": "/sky/deep/m81-1280.jpg",
		"artist": "NASA, ESA and the Hubble Heritage Team (STScI/AURA)",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Messier_81_HST.jpg"
	},
	"M82": {
		"small": "/sky/deep/m82-512.jpg",
		"large": "/sky/deep/m82-1280.jpg",
		"artist": "NASA, ESA, and The Hubble Heritage Team (STScI/AURA)",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:M82_HST_ACS_2006-14-a-large_web.jpg"
	},
	"M104": {
		"small": "/sky/deep/m104-512.jpg",
		"large": "/sky/deep/m104-1280.jpg",
		"artist": "ESA/Hubble & NASA, K. Noll",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Sombrero_Galaxy_(heic2506a).jpg"
	},
	"NGC 253": {
		"small": "/sky/deep/ngc-253-512.jpg",
		"large": "/sky/deep/ngc-253-1280.jpg",
		"artist": "Chuck Ayoub",
		"license": "CC0",
		"source": "https://commons.wikimedia.org/wiki/File:NGC_253_-_Sculptor.jpg"
	},
	"M87": {
		"small": "/sky/deep/m87-512.jpg",
		"large": "/sky/deep/m87-1280.jpg",
		"artist": "NASA, STScI, WikiSky",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Messier_87_Hubble_WikiSky.jpg"
	},
	"LMC": {
		"small": "/sky/deep/lmc-512.jpg",
		"large": "/sky/deep/lmc-1280.jpg",
		"artist": "Robert Gendler/ESO",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Eso1021d.jpg"
	},
	"SMC": {
		"small": "/sky/deep/smc-512.jpg",
		"large": "/sky/deep/smc-1280.jpg",
		"artist": "ESA/Hubble and Digitized Sky Survey 2",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Small_Magellanic_Cloud_(Digitized_Sky_Survey_2).jpg"
	},
	"M42": {
		"small": "/sky/deep/m42-512.jpg",
		"large": "/sky/deep/m42-1280.jpg",
		"artist": "NASA, ESA, M. Robberto (Space Telescope Science Institute/ESA) and the Hubble Space Telescope Orion Treasury Project Team",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg"
	},
	"M8": {
		"small": "/sky/deep/m8-512.jpg",
		"large": "/sky/deep/m8-1280.jpg",
		"artist": "ESO/VPHAS+ team",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:VST_images_the_Lagoon_Nebula.jpg"
	},
	"M20": {
		"small": "/sky/deep/m20-512.jpg",
		"large": "/sky/deep/m20-1280.jpg",
		"artist": "RubinObs/NOIRLab/SLAC/NSF/DOE/AURA",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Trifid_Nebula_(noirlab2521ah).jpg"
	},
	"M16": {
		"small": "/sky/deep/m16-512.jpg",
		"large": "/sky/deep/m16-1280.jpg",
		"artist": "ESO",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Eagle_Nebula_from_ESO.jpg"
	},
	"M17": {
		"small": "/sky/deep/m17-512.jpg",
		"large": "/sky/deep/m17-1280.jpg",
		"artist": "ESO/INAF-VST/OmegaCAM. Acknowledgement: OmegaCen/Astro-WISE/Kapteyn Institute",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:VST_image_of_the_spectacular_star-forming_region_Messier_17_(Omega_Nebula).jpg"
	},
	"NGC 3372": {
		"small": "/sky/deep/ngc-3372-512.jpg",
		"large": "/sky/deep/ngc-3372-1280.jpg",
		"artist": "Harel Boren",
		"license": "CC BY-SA 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Carina_Nebula_by_Harel_Boren_(151851961,_modified).jpg"
	},
	"NGC 7000": {
		"small": "/sky/deep/ngc-7000-512.jpg",
		"large": "/sky/deep/ngc-7000-1280.jpg",
		"artist": "gjdonatiello",
		"license": "CC0",
		"source": "https://commons.wikimedia.org/wiki/File:NGC_7000_%2B_IC_5070.jpg"
	},
	"M57": {
		"small": "/sky/deep/m57-512.jpg",
		"large": "/sky/deep/m57-1280.jpg",
		"artist": "ESA/Webb, NASA, CSA, M. Barlow, N. Cox, R. Wesson",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Webb_captures_detailed_beauty_of_Ring_Nebula_(NIRCam_image)_(weic2320b).jpg"
	},
	"M27": {
		"small": "/sky/deep/m27-512.jpg",
		"large": "/sky/deep/m27-1280.jpg",
		"artist": "REU program/NOIRLab/NSF/AURA",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:M27_-_Noao-m27.jpg"
	},
	"NGC 7293": {
		"small": "/sky/deep/ngc-7293-512.jpg",
		"large": "/sky/deep/ngc-7293-1280.jpg",
		"artist": "NASA, ESA, C.R. O'Dell (Vanderbilt University), M. Meixner and P. McCullough (STScI)",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:NGC7293_(2004).jpg"
	},
	"M1": {
		"small": "/sky/deep/m1-512.jpg",
		"large": "/sky/deep/m1-1280.jpg",
		"artist": "NASA, ESA, J. Hester and A. Loll (Arizona State University)",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Crab_Nebula.jpg"
	},
	"NGC 6960/6992": {
		"small": "/sky/deep/ngc-6960-6992-512.jpg",
		"large": "/sky/deep/ngc-6960-6992-1280.jpg",
		"artist": "Ken Crawford",
		"license": "CC BY-SA 3.0",
		"source": "https://commons.wikimedia.org/wiki/File:Veil_Nebula_-_NGC6960.jpg"
	},
	"M45": {
		"small": "/sky/deep/m45-512.jpg",
		"large": "/sky/deep/m45-1280.jpg",
		"artist": "NASA, ESA, AURA/Caltech, Palomar Observatory The science team consists of: D. Soderblom and E. Nelan (STScI), F. Benedict and B. Arthur (U. Texas), and B. Jones (Lick Obs.)",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Pleiades_large.jpg"
	},
	"M44": {
		"small": "/sky/deep/m44-512.jpg",
		"large": "/sky/deep/m44-1280.jpg",
		"artist": "Chuck Ayoub",
		"license": "CC0",
		"source": "https://commons.wikimedia.org/wiki/File:M44-Star-Cluster.jpg"
	},
	"NGC 869/884": {
		"small": "/sky/deep/ngc-869-884-512.jpg",
		"large": "/sky/deep/ngc-869-884-1280.jpg",
		"artist": "Genuson",
		"license": "CC BY-SA 3.0",
		"source": "https://commons.wikimedia.org/wiki/File:Double_Cluster.jpg"
	},
	"M13": {
		"small": "/sky/deep/m13-512.jpg",
		"large": "/sky/deep/m13-1280.jpg",
		"artist": "Chuck Ayoub",
		"license": "CC0",
		"source": "https://commons.wikimedia.org/wiki/File:M13-Globular-Cluster.jpg"
	},
	"M22": {
		"small": "/sky/deep/m22-512.jpg",
		"large": "/sky/deep/m22-1280.jpg",
		"artist": "ESA/Hubble & NASA",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:The_crammed_centre_of_Messier_22.jpg"
	},
	"NGC 5139": {
		"small": "/sky/deep/ngc-5139-512.jpg",
		"large": "/sky/deep/ngc-5139-1280.jpg",
		"artist": "Chuck Ayoub",
		"license": "CC0",
		"source": "https://commons.wikimedia.org/wiki/File:Omega_Centauri_Stars.jpg"
	},
	"NGC 104": {
		"small": "/sky/deep/ngc-104-512.jpg",
		"large": "/sky/deep/ngc-104-1280.jpg",
		"artist": "NASA, ESA, and the Hubble Heritage (STScI/AURA)-ESA/Hubble Collaboration Acknowledgment: J. Mack (STScI) and G. Piotto (University of Padova, Italy)",
		"license": "CC BY 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Heic1510a.tif"
	}
};

// Comet photos, keyed by the ids in comets.ts; shown along the comet's tail when zoomed in.
export const cometImages: Record<string, ImageCredit & { small: string; large: string }> = {
	"halley": {
		"small": "/sky/comets/halley-512.jpg",
		"large": "/sky/comets/halley-1280.jpg",
		"artist": "NASA/W. Liller",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Lspn_comet_halley.jpg"
	},
	"hale-bopp": {
		"small": "/sky/comets/hale-bopp-512.jpg",
		"large": "/sky/comets/hale-bopp-1280.jpg",
		"artist": "E. Kolmhofer, H. Raab; Johannes-Kepler-Observatory, Linz, Austria",
		"license": "CC BY-SA 3.0",
		"source": "https://commons.wikimedia.org/wiki/File:Comet_Hale-Bopp_1995O1.jpg"
	},
	"neowise": {
		"small": "/sky/comets/neowise-512.jpg",
		"large": "/sky/comets/neowise-1280.jpg",
		"artist": "SimgDe",
		"license": "CC BY-SA 4.0",
		"source": "https://commons.wikimedia.org/wiki/File:Comet_2020_F3_(NEOWISE)_on_Jul_14_2020_aligned_to_stars.jpg"
	},
	"hyakutake": {
		"small": "/sky/comets/hyakutake-512.jpg",
		"large": "/sky/comets/hyakutake-1280.jpg",
		"artist": "E. Kolmhofer, H. Raab; Johannes-Kepler-Observatory, Linz, Austria",
		"license": "CC BY-SA 3.0",
		"source": "https://commons.wikimedia.org/wiki/File:Hyakutake_Color.jpg"
	},
	"tsuchinshan-atlas": {
		"small": "/sky/comets/tsuchinshan-atlas-512.jpg",
		"large": "/sky/comets/tsuchinshan-atlas-1280.jpg",
		"artist": "Jim Vajda",
		"license": "CC BY 2.0",
		"source": "https://commons.wikimedia.org/wiki/File:Comet_Tsuchinshan%E2%80%93ATLAS_over_Ohio_(Composite).jpg"
	},
	"pons-brooks": {
		"small": "/sky/comets/pons-brooks-512.jpg",
		"large": "/sky/comets/pons-brooks-1280.jpg",
		"artist": "Taavi Niittee/Tõrva Astronoomiaklubi/Tõrva Astronomy Club",
		"license": "CC0",
		"source": "https://commons.wikimedia.org/wiki/File:Pons_brooks.jpg"
	},
	"encke": {
		"small": "/sky/comets/encke-512.jpg",
		"large": "/sky/comets/encke-1280.jpg",
		"artist": "Jim Scotti",
		"license": "Public domain",
		"source": "https://commons.wikimedia.org/wiki/File:Comet_Encke.jpg"
	}
};
