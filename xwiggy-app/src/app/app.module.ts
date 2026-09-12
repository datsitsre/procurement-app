import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { LoginComponent } from './login/login.component';
import {Router, RouterModule, Routes} from "@angular/router";
import { RegisterComponent } from './register/register.component';
import { HomeComponent } from './home/home.component';
import { FormsModule} from "@angular/forms";
import { HttpClientModule, HTTP_INTERCEPTORS} from "@angular/common/http";
import { MenuComponent } from './menu/menu.component';
import { CheckoutComponent } from './checkout/checkout.component';
import { SuccessComponent } from './success/success.component';
import { MerchantMenuComponent } from './merchant-menu/merchant-menu.component';
import { AddItemComponent } from './add-item/add-item.component';
import { ContactUsComponent } from './contact-us/contact-us.component';
import { AuthInterceptor } from './auth.interceptor';
import { AuthGuard, MerchantGuard } from './auth.guard';
import { MerchantOrdersComponent } from './merchant-orders/merchant-orders.component';
import { OrderDetailComponent } from './order-detail/order-detail.component';
import { MyOrdersComponent } from './my-orders/my-orders.component';
import { OrderTrackingComponent } from './order-tracking/order-tracking.component';

const appRoutes:Routes=[
  {path:'login',
  component:LoginComponent},
  {path:'register',
  component:RegisterComponent},
  // The old profile-only welcome page has been folded into the menu dashboard - keep the
  // route working for anyone with a bookmark/stale link.
  {path:'welcome',
  redirectTo:'menu'},
  {path:'menu',
  component:MenuComponent,
  canActivate:[AuthGuard]},
  {path:'myOrders',
  component:MyOrdersComponent,
  canActivate:[AuthGuard]},
  {path:'myOrders/:id',
  component:OrderTrackingComponent,
  canActivate:[AuthGuard]},
  {path:'home',
  component:HomeComponent},
  {path:'checkout',
  component:CheckoutComponent,
  canActivate:[AuthGuard]},
  {path:'success',
  component:SuccessComponent,
  canActivate:[AuthGuard]},
  // The old merchant profile-only page has been folded into the merchant menu dashboard.
  {path:'merchantWelcome',
  redirectTo:'merchantMenu'},
  {path:'merchantMenu',
  component:MerchantMenuComponent,
  canActivate:[MerchantGuard]},
  {path:'merchantOrders',
  component:MerchantOrdersComponent,
  canActivate:[MerchantGuard]},
  {path:'merchantOrders/:id',
  component:OrderDetailComponent,
  canActivate:[MerchantGuard]},
  {path:'',
  component:HomeComponent},
  {path:'addItem',
  component:AddItemComponent,
  canActivate:[MerchantGuard]},
  {path:'contactUs',
  component:ContactUsComponent,
  canActivate:[AuthGuard]},
  {path:'**',
  redirectTo:''},
];

@NgModule({
  declarations: [
    AppComponent,
    LoginComponent,
    RegisterComponent,
    HomeComponent,
    MenuComponent,
    CheckoutComponent,
    SuccessComponent,
    MerchantMenuComponent,
    AddItemComponent,
    ContactUsComponent,
    MerchantOrdersComponent,
    OrderDetailComponent,
    MyOrdersComponent,
    OrderTrackingComponent
  ],
  imports: [
    BrowserModule,
    RouterModule.forRoot(appRoutes,{useHash: true}),
    FormsModule,
    HttpClientModule,
    AppRoutingModule
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
