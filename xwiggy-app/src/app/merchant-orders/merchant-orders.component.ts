import { Component, OnInit } from '@angular/core';
import { environment } from "../../environments/environment";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { User } from "../app.component";

@Component({
  standalone: false,
  selector: 'app-merchant-orders',
  templateUrl: './merchant-orders.component.html',
  styleUrls: ['./merchant-orders.component.css']
})
export class MerchantOrdersComponent implements OnInit {

  orders:Order[] = [];
  loading:boolean=true;
  loadError:string=null;
  message:string=null;
  searchText:string='';

  // Which order id currently has a status-change request in flight, so its buttons can
  // show a busy state without blocking the rest of the board.
  updatingId:number=null;

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
    let url = `${environment.apiUrl}/merchant/orders`;
    this.http.get<Order[]>(url).subscribe({
      next: (orders) => {
        this.loading = false;
        this.orders = orders;
      },
      error: () => {
        this.loading = false;
        this.loadError = "Couldn't load orders. Check your connection and try again.";
      }
    });
  }

  get filteredOrders():Order[]{
    const text = this.searchText.trim().toLowerCase();
    if (!text) return this.orders;
    return this.orders.filter(o =>
      String(o.id).includes(text) || o.username.toLowerCase().includes(text)
    );
  }

  ordersByStatus(status:string):Order[]{
    return this.filteredOrders.filter(o => o.status === status);
  }

  itemCount(order:Order):number{
    return order.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  updateStatus(order:Order, newStatus:string):void{
    if (this.updatingId !== null) return;
    this.message = null;
    this.updatingId = order.id;
    let url = `${environment.apiUrl}/merchant/orders/${order.id}/status`;
    this.http.post<Order>(url, { status: newStatus }).subscribe({
      next: (updated) => {
        this.updatingId = null;
        const idx = this.orders.findIndex(o => o.id === updated.id);
        if (idx >= 0) this.orders[idx] = updated;
      },
      error: (err) => {
        this.updatingId = null;
        this.message = typeof err.error === 'string' ? err.error : "Couldn't update that order. Please try again.";
      }
    });
  }

  accept(order:Order):void{ this.updateStatus(order, 'CONFIRMED'); }
  reject(order:Order):void{ this.updateStatus(order, 'REJECTED'); }
  markReady(order:Order):void{ this.updateStatus(order, 'READY'); }
  markDispatched(order:Order):void{ this.updateStatus(order, 'DISPATCHED'); }
}

export interface OrderItemLine {
  id:number;
  foodId:string;
  itemName:string;
  quantity:number;
  price:number;
}

export interface Order {
  id:number;
  username:string;
  orderDate:string;
  total:number;
  status:string;
  items:OrderItemLine[];
}
