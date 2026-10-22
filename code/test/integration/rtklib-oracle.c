// SPDX-License-Identifier: AGPL-3.0-only
/* Independent test-vector generator. Link the pinned upstream RTKLIB
 * rtkcmn.c/ephemeris.c unchanged; this file does not call Non-verba code.
 * All orbit inputs and observations are deliberately synthetic. */
#include "rtklib.h"

/* Unused optional RTKLIB paths must fail if accidentally reached. The oracle
 * uses only GPS broadcast eph2pos, never precise/SSR/SBAS/LEX positioning. */
int peph2pos(gtime_t t,int sat,const nav_t *n,int opt,double *rs,double *dts,double *var){abort();return 0;}
void satantoff(gtime_t t,const double *rs,int sat,const nav_t *n,double *dant){abort();}
int sbssatcorr(gtime_t t,int sat,const nav_t *n,double *rs,double *dts,double *var){abort();return 0;}
int lexeph2pos(gtime_t t,int sat,const nav_t *n,double *rs,double *dts,double *var){abort();return 0;}

int main(int argc, char **argv) {
    const double llh[3]={47.4979*D2R,19.0402*D2R,120.0};
    const double ion[8]={1.2e-8,1.49e-8,-5.96e-8,-1.19e-7,1.167e5,1.3107e5,-1.3107e5,-2.6214e5};
    double rr[3]; int sat,epoch,j,first;
    int rollover=argc==2 && strcmp(argv[1],"--week-rollover")==0;
    int orbit_week=rollover?2199:2200;
    double toe=rollover?604700.0:100000.0;
    eph_t ephemerides[32];
    if(argc>2 || (argc==2 && !rollover))return 2;
    pos2ecef(llh,rr);
    memset(ephemerides,0,sizeof(ephemerides));
    printf("{\"reference\":\"RTKLIB 71db0ffa0d9735697c6adfd06fdf766d0e5ce807\",\"synthetic\":true,\"receiver_llh\":[47.4979,19.0402,120],\"receiver_ecef_m\":[%.15g,%.15g,%.15g],\"receiver_clock_bias_m\":75,\"gps_week\":2200,\"ionosphere\":{\"alpha\":[1.2e-8,1.49e-8,-5.96e-8,-1.19e-7],\"beta\":[1.167e5,1.3107e5,-1.3107e5,-2.6214e5]},\"ephemerides\":[",rr[0],rr[1],rr[2]);
    for(sat=1;sat<=32;sat++) {
        eph_t *p=ephemerides+sat-1;
        p->sat=sat; p->week=orbit_week; p->toes=toe; p->toe=p->toc=gpst2time(orbit_week,toe);
        p->ttr=gpst2time(orbit_week,toe-100); p->fit=4; p->iode=p->iodc=sat; p->sva=0;
        p->A=26560000.0+sat*20; p->e=.005+sat*.0001; p->deln=4e-9;
        p->M0=2*PI*((sat-1)%4)/4.0+((sat-1)/4)*.31;
        p->omg=.2+sat*.03; p->OMG0=fmod(2*PI*((sat-1)/4)/8.0+OMGE*toe,2*PI);
        p->OMGd=-8e-9; p->i0=.94+.01*sin(sat); p->idot=2e-10;
        p->cuc=1e-6; p->cus=-2e-6; p->crc=100+sat; p->crs=-30-sat;
        p->cic=2e-7; p->cis=-3e-7; p->f0=(sat-16)*1e-5; p->f1=sat*1e-12; p->f2=-2e-20; p->tgd[0]=-sat*1e-9;
        printf("%s{\"svid\":%d,\"gps_week\":%d,\"toe_s\":%.17g,\"toc_s\":%.17g,\"transmission_tow_s\":%.17g,\"fit_interval_hours\":4,\"iode\":%d,\"iodc\":%d,\"health\":0,\"ura_m\":2.4,\"sqrt_a_m_sqrt\":%.17g,\"e\":%.17g,\"delta_n_rad_s\":%.17g,\"m0_rad\":%.17g,\"omega_rad\":%.17g,\"omega0_rad\":%.17g,\"omega_dot_rad_s\":%.17g,\"i0_rad\":%.17g,\"idot_rad_s\":%.17g,\"cuc_rad\":%.17g,\"cus_rad\":%.17g,\"crc_m\":%.17g,\"crs_m\":%.17g,\"cic_rad\":%.17g,\"cis_rad\":%.17g,\"af0_s\":%.17g,\"af1_s_s\":%.17g,\"af2_s_s2\":%.17g,\"tgd_s\":%.17g}",sat==1?"":",",sat,orbit_week,toe,toe,toe-100,sat,sat,sqrt(p->A),p->e,p->deln,p->M0,p->omg,p->OMG0,p->OMGd,p->i0,p->idot,p->cuc,p->cus,p->crc,p->crs,p->cic,p->cis,p->f0,p->f1,p->f2,p->tgd[0]);
    }
    printf("],\"epochs\":[");
    for(epoch=0;epoch<=10;epoch++) {
        double receive_tow=(rollover?0.02:100100.0)+epoch;
        printf("%s{\"true_receive_tow_s\":%.17g,\"receiver_clock_bias_ns\":%.17g,\"satellites\":[",epoch?",":"",receive_tow,75.0/CLIGHT*1e9);
        first=1;
        for(sat=1;sat<=32;sat++) {
            eph_t *p=ephemerides+sat-1;
            double transmit_tow=receive_tow-.075,rs[3],clock,variance,los[3],azel[2],range,iono,trop,pseudorange,signal_tow;
            for(j=0;j<8;j++) {
                eph2pos(gpst2time(2200,transmit_tow),p,rs,&clock,&variance);
                range=geodist(rs,rr,los); satazel(llh,los,azel);
                iono=ionmodel(gpst2time(2200,receive_tow),ion,llh,azel);
                trop=tropmodel(gpst2time(2200,receive_tow),llh,azel,.7);
                transmit_tow=receive_tow-(range+iono+trop)/CLIGHT;
            }
            if(azel[1]<10*D2R)continue;
            pseudorange=range+iono+trop+75.0-CLIGHT*(clock-p->tgd[0]);
            signal_tow=transmit_tow+clock-p->tgd[0];
            if(signal_tow<0.0)signal_tow+=604800.0;
            printf("%s{\"svid\":%d,\"transmit_tow_s\":%.17g,\"sv_time_tow_ns\":\"%.0f\",\"ecef_m\":[%.15g,%.15g,%.15g],\"satellite_clock_s\":%.17g,\"geometric_range_m\":%.17g,\"ionosphere_m\":%.17g,\"troposphere_m\":%.17g,\"azimuth_deg\":%.15g,\"elevation_deg\":%.15g,\"pseudorange_m\":%.17g}",first?"":",",sat,transmit_tow,signal_tow*1e9,rs[0],rs[1],rs[2],clock,range,iono,trop,azel[0]*R2D,azel[1]*R2D,pseudorange);
            first=0;
        }
        printf("]}");
    }
    printf("]}\n");
    return 0;
}
