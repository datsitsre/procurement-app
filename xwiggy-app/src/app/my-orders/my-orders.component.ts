import { Component, OnInit } from '@angular/core';
import { environment } from "../../environments/environment";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { Order } from "../merchant-orders/merchant-orders.component";
import { User } from "../app.component";

@Component({
  standalone: false,
  selector: 'app-my-orders',
  templateUrl: './my-orders.component.html',
  styleUrls: ['./my-orders.component.css']
})
export class MyOrdersComponent implements OnInit {

  orders:Order[] = [];
  loading:boolean=true;
  loadError:string=null;

  user:User=null;

  constructor(private http:HttpClient, private router:Router) { }

  ngOnInit() {
    if (sessionStorage.getItem("userData") == null) {
      this.router.navigate(['login']);
      return;
    }
    this.user = JSON.parse(sessionStorage.getItem('userData'));
    this.getOrders();
  }

  clearLocal(){
    sessionStorage.clear();
  }

  getOrders():void{
    this.loading = true;
    this.loadError = null;
    let url = `${environment.apiUrl}/orders`;
    this.http.get<Order[]>(url).subscribe({
      next: (orders) => {
        this.loading = false;
        this.orders = orders;
      },
      error: () => {
        this.loading = false;
        this.loadError = "Couldn't load your orders. Check your connection and try again.";
      }
    });
  }

  itemCount(order:Order):number{
    return order.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  statusLabel(status:string):string{
    const labels:{[key:string]:string} = {
      PENDING: 'Awaiting payment',
      PAID: 'Placed',
      CONFIRMED: 'Confirmed',
      READY: 'Ready',
      DISPATCHED: 'Delivered',
      REJECTED: 'Rejected',
    };
    return labels[status] || status;
  }

  // Resumes an abandoned checkout - the customer created the order but never paid.
  resumePayment(order:Order, event:Event):void{
    event.stopPropagation();
    event.preventDefault();
    sessionStorage.setItem('orderId', String(order.id));
    sessionStorage.setItem('total', String(order.total));
    this.router.navigate(['checkout']);
  }
}
